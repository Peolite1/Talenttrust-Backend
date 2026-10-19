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

When the escrow contract is paused on-chain or via the `API_PAUSED=true` operator override, mutations that mirror Soroban functions calling `require_not_paused` (`create`, `deposit`, `release`, `dispute`, `cancel`) are rejected with `503 Service Unavailable` (`Retry-After: 60`, `contractError: { name: 'Paused', code: 4 }`). Read-only endpoints as well as dispute resolution (`resolve`) and reputation rating (`reputation`) remain active.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | Service info and endpoint list (JSON) |
| GET | `/health` | Health check (includes `paused` and `pauseSource`) |
| GET | `/docs` | Swagger UI |
| GET | `/openapi.json` | OpenAPI 3 spec |
| GET | `/api/v1/chain` | On-chain contract deployment info (includes `paused` and `pauseSource`) |
| GET | `/api/v1/stats` | Aggregate statistics |
| GET/POST | `/api/v1/contracts` | List (`?status=`, `?party=`) / create escrow contracts (guarded by pause) |
| GET | `/api/v1/contracts/:id` | Get a contract |
| POST | `/api/v1/contracts/:id/deposit` | `{ "amount": 100 }` (guarded by pause) |
| POST | `/api/v1/contracts/:id/milestones/:index/release` | Release a milestone (guarded by pause) |
| POST | `/api/v1/contracts/:id/dispute` | `{ "raisedBy": "G...", "reason": "..." }` (guarded by pause) |
| POST | `/api/v1/contracts/:id/resolve` | `{ "freelancerBps": 5000 }` (allowed while paused) |
| POST | `/api/v1/contracts/:id/cancel` | Cancel and refund (guarded by pause) |
| POST | `/api/v1/contracts/:id/reputation` | `{ "rating": 5 }` (allowed while paused) |
| GET | `/api/v1/reputation/:address` | Freelancer reputation |

## Development

```bash
npm ci
npm run dev      # http://localhost:3001
npm run lint     # type check
npm test
npm run build && npm start
```

### Configuration

All optional (see `.env.example`):
- `PORT`: HTTP port (default `3001`).
- `ESCROW_CONTRACT_ID`: Soroban contract ID.
- `STELLAR_NETWORK`: Stellar network (`testnet` / `mainnet`).
- `STELLAR_RPC_URL`: Soroban RPC endpoint URL.
- `FRONTEND_URL`: Hosted frontend URL.
- `API_PAUSED`: Boolean operator override (`true` rejects mutations immediately without contacting RPC).
- `PAUSE_CHECK_TTL_MS`: Cache TTL in milliseconds for on-chain pause status check (default `10000`).
- `PAUSE_FAIL_MODE`: `open` or `closed` (default `open`).
  - `open` (Fail-Open): If Soroban RPC is unreachable or times out, requests are allowed. Keeps the API available during transient RPC hiccups.
  - `closed` (Fail-Closed): If Soroban RPC is unreachable or times out, guarded mutations are blocked (`503`). Recommended for high-security environments where unverified chain status cannot be permitted.

## Deployment

Deployed on Vercel as a serverless function: `api/index.ts` exports the Express app and
`vercel.json` rewrites every path to it. `src/index.ts` only calls `listen()` when run directly.

```bash
vercel deploy --prod
```

## License

MIT
