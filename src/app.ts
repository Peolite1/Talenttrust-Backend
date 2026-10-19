import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { config, explorerUrl } from './config';
import { EscrowStore, EscrowContract, HttpError } from './store';
import { openapi, docsHtml } from './openapi';

const startedAt = Date.now();

type Handler = (req: Request, res: Response) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    next(err);
  }
};

const id = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'invalid_id', 'id must be a positive integer');
  return n;
};

export function getContractEtag(contract: { id: number; version: number }): string {
  return `"${contract.id}-${contract.version}"`;
}

export function getContractsListEtag(contracts: EscrowContract[], queryString: string = ''): string {
  const pairs = contracts.map((c) => `${c.id}:${c.version}`).join(',');
  const hash = crypto.createHash('sha1').update(`${pairs}?${queryString}`).digest('hex');
  return `"${hash}"`;
}

export class PreconditionFailedError extends HttpError {
  constructor(public currentEtag: string, public currentVersion: number) {
    super(412, 'precondition_failed', 'Precondition failed');
  }
}

export class PreconditionRequiredError extends HttpError {
  constructor() {
    super(428, 'precondition_required', 'If-Match header is required');
  }
}

export function createApp(store: EscrowStore = new EscrowStore().seed()) {
  const app = express();
  app.set('etag', false);
  app.disable('x-powered-by');
  // CSP disabled so the /docs page can load Swagger UI from a CDN.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get(
    '/',
    wrap(() => ({
      name: 'TalentTrust API',
      version: config.version,
      description: 'Milestone-based freelancer escrow API backed by a Soroban contract on Stellar.',
      docs: '/docs',
      openapi: '/openapi.json',
      website: config.frontendUrl,
      chain: { network: config.network, contractId: config.contractId, explorer: explorerUrl() },
      endpoints: [
        'GET  /health',
        'GET  /docs',
        'GET  /openapi.json',
        'GET  /api/v1/chain',
        'GET  /api/v1/stats',
        'GET  /api/v1/contracts',
        'POST /api/v1/contracts',
        'GET  /api/v1/contracts/:id',
        'POST /api/v1/contracts/:id/deposit',
        'POST /api/v1/contracts/:id/milestones/:index/release',
        'POST /api/v1/contracts/:id/dispute',
        'POST /api/v1/contracts/:id/resolve',
        'POST /api/v1/contracts/:id/cancel',
        'POST /api/v1/contracts/:id/reputation',
        'GET  /api/v1/reputation/:address',
      ],
    })),
  );

  app.get(
    '/health',
    wrap(() => ({
      status: 'ok',
      version: config.version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      storage: 'in-memory',
      timestamp: new Date().toISOString(),
    })),
  );

  app.get('/openapi.json', wrap(() => openapi));
  app.get(['/docs', '/docs/'], (_req, res) => {
    res.type('html').send(docsHtml);
  });

  const v1 = express.Router();
  v1.get(
    '/chain',
    wrap(() => ({
      network: config.network,
      rpcUrl: config.rpcUrl,
      contractId: config.contractId,
      explorer: explorerUrl(),
    })),
  );
  v1.get('/stats', wrap(() => store.stats()));
  v1.get(
    '/contracts',
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const contracts = store.list({
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          party: typeof req.query.party === 'string' ? req.query.party : undefined,
        });
        const qs = req.url.includes('?') ? req.url.split('?')[1] : '';
        const etag = getContractsListEtag(contracts, qs);
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'no-cache');

        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch) {
          const clientEtags = ifNoneMatch
            .split(',')
            .map((s) => s.trim())
            .map((s) => (s.startsWith('W/') ? s.slice(2) : s));
          if (clientEtags.includes(etag) || clientEtags.includes('*')) {
            res.status(304).end();
            return;
          }
        }

        res.json({ data: contracts });
      } catch (err) {
        next(err);
      }
    },
  );
  v1.post(
    '/contracts',
    wrap((req, res) => {
      const contract = store.create(req.body ?? {});
      res.setHeader('ETag', getContractEtag(contract));
      res.status(201).json(contract);
    }),
  );
  v1.get('/contracts/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const contract = store.get(id(req));
      const etag = getContractEtag(contract);
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');

      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch) {
        const clientEtags = ifNoneMatch
          .split(',')
          .map((s) => s.trim())
          .map((s) => (s.startsWith('W/') ? s.slice(2) : s));
        if (clientEtags.includes(etag) || clientEtags.includes('*')) {
          res.status(304).end();
          return;
        }
      }

      res.json(contract);
    } catch (err) {
      next(err);
    }
  });

  // Concurrency check middleware for mutations on /contracts/:id/*
  const checkMutationPreconditions = (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractId = id(req);
      const contract = store.get(contractId);
      const ifMatch = req.headers['if-match'];

      if (!ifMatch) {
        if (config.requireIfMatch || process.env.REQUIRE_IF_MATCH === 'true') {
          throw new PreconditionRequiredError();
        }
      } else {
        const currentEtag = getContractEtag(contract);
        const matchValues = ifMatch.split(',').map((s) => s.trim());
        const isMatch =
          matchValues.includes('*') ||
          matchValues.includes(currentEtag) ||
          matchValues.includes(`W/${currentEtag}`) ||
          matchValues.some((val) => (val.startsWith('W/') ? val.slice(2) : val) === currentEtag);

        if (!isMatch) {
          throw new PreconditionFailedError(currentEtag, contract.version);
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  v1.post(
    '/contracts/:id/deposit',
    checkMutationPreconditions,
    wrap((req, res) => {
      const updated = store.deposit(id(req), req.body?.amount);
      res.setHeader('ETag', getContractEtag(updated));
      return updated;
    }),
  );
  v1.post(
    '/contracts/:id/milestones/:index/release',
    checkMutationPreconditions,
    wrap((req, res) => {
      const updated = store.release(id(req), Number(req.params.index));
      res.setHeader('ETag', getContractEtag(updated));
      return updated;
    }),
  );
  v1.post(
    '/contracts/:id/dispute',
    checkMutationPreconditions,
    wrap((req, res) => {
      const updated = store.openDispute(id(req), req.body?.raisedBy, req.body?.reason);
      res.setHeader('ETag', getContractEtag(updated));
      return updated;
    }),
  );
  v1.post(
    '/contracts/:id/resolve',
    checkMutationPreconditions,
    wrap((req, res) => {
      const updated = store.resolveDispute(id(req), req.body?.freelancerBps);
      res.setHeader('ETag', getContractEtag(updated));
      return updated;
    }),
  );
  v1.post(
    '/contracts/:id/cancel',
    checkMutationPreconditions,
    wrap((req, res) => {
      const updated = store.cancel(id(req));
      res.setHeader('ETag', getContractEtag(updated));
      return updated;
    }),
  );
  v1.post(
    '/contracts/:id/reputation',
    checkMutationPreconditions,
    wrap((req, res) => {
      const rep = store.rate(id(req), req.body?.rating);
      const contract = store.get(id(req));
      res.setHeader('ETag', getContractEtag(contract));
      return rep;
    }),
  );
  v1.get('/reputation/:address', wrap((req) => store.getReputation(req.params.address)));
  app.use('/api/v1', v1);

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}`, docs: '/docs' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof PreconditionFailedError) {
      res.setHeader('ETag', err.currentEtag);
      res.status(412).json({
        error: err.code,
        message: err.message,
        currentVersion: err.currentVersion,
      });
      return;
    }
    if (err instanceof PreconditionRequiredError) {
      res.status(428).json({
        error: err.code,
        message: err.message,
      });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json', message: 'Malformed JSON body' });
      return;
    }
    res.status(500).json({ error: 'internal_error', message: 'Unexpected error' });
  });

  return app;
}

export default createApp;
