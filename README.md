# TalentTrust Backend

## Live

- Website: https://talenttrust-frontend.vercel.app
- Docs: https://talenttrust-frontend.vercel.app/docs
- API: https://talenttrust-backend.vercel.app
- API docs (Swagger UI): https://talenttrust-backend.vercel.app/docs
- Contract (Stellar testnet): [`CCZMIVUBMG5SBC47SDTC32RWLBJ2HW2DCFVWJEOKCH2IFJBZGBKTXK5W`](https://stellar.expert/explorer/testnet/contract/CCZMIVUBMG5SBC47SDTC32RWLBJ2HW2DCFVWJEOKCH2IFJBZGBKTXK5W)

Express + TypeScript API for TalentTrust, a milestone-based freelancer escrow protocol on Stellar.
The API mirrors the state machine of the Soroban escrow contract
([Talenttrust-Contracts](https://github.com/Talenttrust/Talenttrust-Contracts)) so clients and
freelancers can create engagements, fund escrow, release milestones, raise disputes and build reputation.

Storage is in-memory (seeded with demo data), so no database is required. On serverless hosting the
data is per-instance and resets on redeploy.

## Endpoints

All `GET` endpoints for contracts return strong `ETag` and `Cache-Control: no-cache` headers and support `If-None-Match` conditional requests (returning `304 Not Modified` when matched). All `POST /api/v1/contracts/:id/*` mutation endpoints support `If-Match` for optimistic concurrency control (returning `412 Precondition Failed` on mismatch and `428 Precondition Required` when mandatory).

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | Service info and endpoint list (JSON) |
| GET | `/health` | Health check |
| GET | `/docs` | Swagger UI |
| GET | `/openapi.json` | OpenAPI 3 spec |
| GET | `/api/v1/chain` | On-chain contract deployment info |
| GET | `/api/v1/stats` | Aggregate statistics |
| GET/POST | `/api/v1/contracts` | List (`?status=`, `?party=`, `If-None-Match`) / create escrow contracts |
| GET | `/api/v1/contracts/:id` | Get a contract (`If-None-Match`) |
| POST | `/api/v1/contracts/:id/deposit` | `{ "amount": 100 }` (`If-Match`) |
| POST | `/api/v1/contracts/:id/milestones/:index/release` | Release a milestone (`If-Match`) |
| POST | `/api/v1/contracts/:id/dispute` | `{ "raisedBy": "G...", "reason": "..." }` (`If-Match`) |
| POST | `/api/v1/contracts/:id/resolve` | `{ "freelancerBps": 5000 }` (`If-Match`) |
| POST | `/api/v1/contracts/:id/cancel` | Cancel and refund (`If-Match`) |
| POST | `/api/v1/contracts/:id/reputation` | `{ "rating": 5 }` (`If-Match`) |
| GET | `/api/v1/reputation/:address` | Freelancer reputation |

## Development

```bash
npm ci
npm run dev      # http://localhost:3001
npm run lint     # type check
npm test
npm run build && npm start
```

Configuration (all optional, see `.env.example`): `PORT`, `ESCROW_CONTRACT_ID`, `STELLAR_NETWORK`,
`STELLAR_RPC_URL`, `FRONTEND_URL`, `REQUIRE_IF_MATCH`.

## Deployment

Deployed on Vercel as a serverless function: `api/index.ts` exports the Express app and
`vercel.json` rewrites every path to it. `src/index.ts` only calls `listen()` when run directly.

```bash
vercel deploy --prod
```

## License

MIT
