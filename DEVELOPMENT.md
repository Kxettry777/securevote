# SecureVote development

## Implemented

SecureVote now supports the complete local voting workflow:

- Registration, password hashing, login, expiring sessions, and administrator approval/revocation.
- Admin registration of political parties with symbol images and dedicated party sign-in accounts.
- Party-owned candidate nominations, separate role hierarchies per party, and complete-roster submission.
- Admin voter registration with immediate approval or pending review.
- Removal/restoration of ended elections and confirmed deletion of individual or bulk audit entries.
- Election creation from 2 to 100 submitted party rosters, immutable ballot snapshots, and approved voter assignments.
- Administrator banner uploads with preview, replacement, removal, and protected image access.
- Server-aligned countdowns before and during voting on election cards, details, and ballots.
- Five-minute voting credentials, party selection, explicit ballot confirmation, and one vote per assigned voter.
- Solidity ballot recording on a persistent local Ganache ledger, with confirmed transaction receipts.
- Recovery of saved submissions after connection interruptions or an API restart.
- Results after the election ends, ties and zero-vote outcomes, transaction references, and downloadable JSON audit reports.
- Read-only election/results access for candidate and auditor roles. Only admins see assigned voter lists.
- An admin-only audit log for election, candidate, assignment, approval, and revocation changes.

Optional AI liveness is not implemented. The README remains the broader project proposal;
its planned features should not be read as a claim that every module is complete.

## Quick start (Windows)

Use Node.js 24 and MySQL 8.0 or later. Commands below use `npm.cmd` because the
PowerShell execution policy on this machine blocks the `npm.ps1` wrapper.

1. Keep your existing `backend/.env`. For a fresh installation, copy
   `backend/.env.example` and set `MYSQL_*`, a strong `JWT_SECRET`, and `ADMIN_*`.
   Quote passwords containing `#`. Never commit `.env`.
2. Install dependencies and apply the non-destructive table setup:

   ```powershell
   npm.cmd run setup
   ```

3. Start the entire local stack:

   ```powershell
   npm.cmd run dev
   ```

4. Open **http://127.0.0.1:5173**. Sign in with the administrator configured in
   `backend/.env`. The admin seed creates an account only when that email is absent;
   changing `ADMIN_PASSWORD` later does not reset an existing password.

The launcher applies missing tables, starts the persistent local ledger on port
8545, deploys/verifies the contract, and starts the API and frontend. Stop existing
instances using those ports first. Press Ctrl+C to stop its services. Restart the
command after backend changes; Vite reloads frontend changes automatically.

`PORT` changes the API port and the launcher configures the frontend proxy to match.
When starting Vite separately, use `API_PROXY_TARGET` to override its default API
address, `http://127.0.0.1:5000`.

### Separate terminals

```powershell
npm.cmd --prefix backend run db:setup
npm.cmd --prefix backend run chain:node
# In a second terminal, after the ledger starts:
npm.cmd --prefix backend run chain:deploy
npm.cmd --prefix backend run dev
# In a third terminal:
npm.cmd --prefix frontend run dev
```

The deployment command is idempotent: it verifies an existing contract instead of
replacing it. The compiler uses the installed `solc` package and targets Shanghai.
Ganache can report a missing native uWS binary on Node 24; it falls back to its
JavaScript transport, which is sufficient for this local prototype.

## Demonstration

### Party elections, banners, and countdowns

Use the sidebar in this order:

1. **Register political party** (admin): register the party name, abbreviation,
   manifesto, symbol name, and a PNG/JPEG/WebP symbol image (up to 4 MB / 16 million
   pixels). Supply a unique party email and initial password. The account, hashed
   password, party, default roles, and audit entry are saved together. Share the
   credentials with the intended representative outside the app; no email is sent.
   Public registration creates voter accounts only.
2. **Candidate roles** (admin): select a political party, then customize its
   President, Vice president, and Secretary positions or add more roles. Each party
   has its own names and hierarchy ranks; lower ranks appear first. A party must
   nominate one candidate for each of its roles. Changing one party's roles does
   not change another party's roles or submission status.
3. **My candidates** (party account): sign in using the party credentials, nominate
   a person for each position, and choose **Submit candidate roster**. A party can
   read and edit only its own registry roster. Admins review nominations but do not
   nominate on a party's behalf. **My party** shows its registered identity/symbol;
   identity changes are made by the admin.
4. **Create election** (admin): select at least two parties with submitted rosters,
   enter the title and future schedule, and create the election. All submitted
   parties are selected initially. Unsubmitted parties cannot be included.
5. Assign approved voters and optionally add a banner before the election starts.

Each ballot choice is a **whole party slate**, with one party vote per voter. Role
hierarchy describes the candidates on that slate, not application permissions.
Separate votes/winners for individual positions are not implemented.

Election creation copies each party's identity, normalized symbol image, and full
ordered candidate roster into an immutable ballot snapshot. Later registry edits
cannot change historical or scheduled ballots. Editing a nominee or party identity
returns that party's roster to draft; editing role definitions returns only the affected party's roster
to draft. Parties must submit again before inclusion in another election. Existing
party options and chain identifiers are preserved for older elections. Older
incomplete elections must be replaced with a newly prepared election; they are not
silently converted into registered parties or party accounts.

The **Election banner** section accepts a local PNG, JPEG, or WebP image up to 4 MB
and 16 million pixels. Preview it, then click **Upload banner** or **Replace banner**.
The server verifies the decoded format, rejects animation and invalid payloads,
removes metadata, and saves a resized WebP in MySQL. Banners are visible only to
accounts allowed to view that election. Banner changes are recorded in the audit
log and lock at the election start time, along with party details and assignments.
Without an uploaded image, the interface shows a standard election indicator.

The countdown shows days, hours, minutes, and seconds until opening or closing.
It uses the database's `serverTime` sample and monotonic elapsed time in the browser,
so changing the device's wall clock does not extend voting. Network transit and
the next block can introduce a small delay; the API and contract remain authoritative.
The local ledger mines a block every second, including while idle, so results can
open after the deadline without requiring someone to send another transaction.

Registry API (authenticated):

- `GET /api/registry`: admin sees all parties/rosters; a party sees only its own.
- `POST /api/registry/parties`: admin creates party + account using `name`,
  `shortName`, `symbol`, `symbolImage` (image data URL), `manifesto`, `email`,
  and `password`. `PATCH /api/registry/parties/:id` edits party identity and
  optionally replaces its image; it does not change account credentials.
- `POST/PATCH /api/registry/roles[/:id]`: admin supplies `partyId`, `name`, and
  integer hierarchy `rank` (1?100). Names and ranks are unique within that party.
  A nomination cannot use a role owned by another party.
- `POST/PATCH /api/registry/candidates[/:id]`: party supplies `partyId`, `roleId`,
  `fullName`, `biography`. Ownership is verified on the server for every write.
- `DELETE /api/registry/candidates/:id`: party removes its own nomination.
- `POST /api/registry/submit`: party submits its complete roster.
- `POST /api/elections`: admin supplies existing schedule fields plus `partyIds`
  (2?100 distinct registered, submitted parties). Creation is atomic.

The former election-local party/candidate mutation endpoints now reject edits
with 409. Existing read aliases and contract identifiers remain compatible.
Banner routes remain `PUT/GET/DELETE /api/elections/:id/banner`. Party accounts
can view elections/results but cannot create elections, assign voters, access the
admin audit log, or cast votes. Ballots still accept `{ partyId, credential }`.

After updating, run `npm.cmd --prefix backend run db:setup` and restart the backend
and local chain. The root `npm.cmd run dev` command performs setup for you when
those services are not already running separately. Keep using the existing ledger.

### Admin account and history management

- **Register voter** opens a dedicated form for a full name, email, initial
  password, and approval status. The admin can approve immediately or leave the
  account pending. This endpoint always creates a voter, regardless of submitted
  role fields. The voter still needs election assignment before voting.
- In **Elections**, **Remove election** is available for ended elections. A
  confirmation explains that it disappears from participant views. **Removed
  elections** lets admins inspect and restore it. Upcoming/active elections cannot
  be removed. This is reversible removal from the application, not erasure of
  blockchain transactions; candidates, assignments, and results remain intact.
- In **Audit log**, admins can delete a single entry or clear all history up to
  their most recent loaded snapshot. Both actions require typing `DELETE`.
  Deletion is permanent. New activity after the snapshot is retained, and clearing
  audit history does not delete elections or recorded votes.

API additions: `POST /api/admin/voters` (`fullName`, `email`, `password`,
`isApproved`), `DELETE /api/elections/:id`, `POST /api/elections/:id/restore`,
`GET /api/elections?removed=true`, `DELETE /api/admin/audit/:id` (body
`{ confirmation: "DELETE" }`), and `DELETE /api/admin/audit` (body
`{ confirmation: "DELETE", throughId }`, using `latestId` from the audit list).
All require an administrator account.

Database setup now migrates existing global role definitions and nominations into
party-specific tables in a transaction. Candidate IDs and submitted rosters are
preserved. A migration marker prevents later setup runs from overwriting party
customizations. Existing election snapshots are unchanged. Restart the backend
with the updated code after applying `npm.cmd --prefix backend run db:setup`.

### Walk through a vote

1. Register a voter and confirm that login is blocked before approval.
2. Sign in as the admin, open **Voter management**, and approve the registration.
3. Register two or more party accounts and their symbol images. Sign in as each
   party, fill all candidate positions, and submit its roster.
4. As admin, create an election from the submitted parties starting a few minutes
   from now, upload an optional banner, and assign the approved voter before the start.
5. In another browser session, sign in as the voter and open the assigned election.
6. Follow the countdown. Once voting opens, select a party, choose **Review my choice**, and then
   **Confirm and cast vote**. Only a mined successful receipt displays success.
7. Refresh the page. The confirmed receipt remains available and voting is disabled.
8. After the election ends, refresh results. Candidate totals, ballot events, and
   application receipts should agree. Expand the audit section and download the report.
9. As admin, open **Audit log** to review the election and eligibility changes.

Election dates are displayed in the browser's local time zone and sent/stored in
UTC. Details, candidates, and assignments lock when the election starts. Global
voter approval can still be revoked; the API rechecks it before preparing a ballot.
A submission already authorized and signed may still be mined after later revocation.

Candidate/auditor accounts are supported by the API and frontend but are not
self-selectable at registration. Provision their roles through a trusted local
administrator/database workflow. Voter registration never grants elevated roles.

## Credential and transaction design

Each voter/election pair has one stable random 256-bit ballot identifier, called a
nullifier. MySQL stores its AES-256-GCM encrypted form in `voting_credentials`.
The encryption authenticates the voter and election IDs as associated data, so
copying a credential row to another account does not create a usable credential.
The separate encryption key lives in the ignored local deployment configuration.

The browser receives a random five-minute token. MySQL stores only its SHA-256
hash and expiry. Refreshing a token invalidates the earlier token while preserving
the same nullifier. Tokens are bound to the authenticated account and election;
they are held in React memory and are never written to browser storage. A voter
can prepare a new token after reload if no transaction is pending or confirmed.

Before submission, the API locks and rechecks election status, approval,
assignment, candidate membership, token hash, token expiry, and credential reuse.
A database mutex serializes relayer nonce allocation. Signed transaction bytes and
their hash are committed to the anonymous `chain_transactions` outbox before
broadcast. The transaction contains no voter account ID, name, or email.

The contract independently enforces the authorized relayer, election schedule,
candidate membership, expiry, and single use of the nullifier. It has no function
to edit or delete recorded ballots. The API reports success only for a successful
receipt. Pending status and results checks rebroadcast the same saved transaction,
which preserves its hash. A mined failure is shown as failed; an explicit new
submission can replace it while the election is open. `chain_attempts` retains
failed attempt hashes/statuses when a later attempt succeeds.

Results are read from the contract after the election closes. Reconciliation
compares each candidate's total, emitted ballot events, and saved confirmed
transaction hashes. The UI withholds a winner declaration when reconciliation
finds a mismatch or transactions remain pending. Ties are displayed explicitly.

## Persistence and privacy limits

Back up **MySQL and the complete `blockchain/.local` directory together**. That
directory contains the persistent ledger, contract deployment metadata, and the
credential encryption key. Losing the key prevents recovery of voter receipts;
resetting the chain destroys its vote history. Do not delete it to fix a connection
error. The API checks the deployment instance, deployment receipt, chain ID,
relayer, and database binding before continuing with the ledger.

This is a local institutional prototype with a trusted backend/relayer. The server
can decrypt the voter-to-nullifier link, and timing/access metadata can correlate
voters with ballots. It does not provide cryptographic anonymity or a secret ballot
against the election authority. Administrative audit records deliberately exclude
voting credentials, voter ballot references, and candidate choices.

Blockchain transaction calldata is public, so an observer with direct local RPC
access can inspect ballots and infer totals during voting even though the results
API and UI wait for the election to close. The local development mnemonic is public;
never use those accounts on a public network or put real funds in them. The ledger
binds to loopback and the connector accepts only local RPC hosts and chain 31337.

The installed Ganache development dependency has npm advisory findings. It is used
only for local simulation/testing, and is not a production deployment stack. A
production election would require independent security/privacy review, supported
node infrastructure, hardened key management, abuse controls, operational recovery,
and a protocol designed for its actual secrecy and trust requirements.

## Verification

```powershell
npm.cmd run check
```

This runs authentication and contract tests, MySQL/HTTP/blockchain integration
checks, frontend lint, TypeScript checking, and a production frontend build.

Integration tests create uniquely named `securevote_test_*` databases and remove
only those databases afterward. They do not modify the application database.
The test account needs CREATE and DROP DATABASE permissions. The blockchain test
runs its own disposable in-memory ledger and deployment on a random loopback port.

Checks cover authorization, schema reruns, persistence, unique eligibility,
transactional administrative auditing, locked elections, invalid candidates,
credential rotation/expiry, credential theft between accounts, revocation,
concurrent duplicate submissions, interrupted broadcast recovery, mined failure
and explicit retry, closed results, privacy of API responses, and ledger mismatch
rejection. Browser visual/interaction verification still needs the manual demo
above because no browser automation surface was available in this session.

Latest verification: 41 backend test cases passed, including real MySQL/HTTP and
local Ethereum integration; TypeScript and the production frontend build passed.
The installed oxlint native binary is blocked by Windows Application Control, so
`npm run check` currently stops at lint. No Windows security settings were changed.

## API additions

All endpoints require a valid session. Voter endpoints also require current
approval and election assignment.

| Method | Route | Access / behavior |
| --- | --- | --- |
| POST | `/api/elections/:id/credentials` | Voter: rotate a short-lived voting token |
| POST | `/api/elections/:id/ballots` | Voter: submit `{ candidateId, credential }`; returns a receipt/status |
| GET | `/api/elections/:id/ballot` | Voter: recover/reconcile this account's submission |
| GET | `/api/elections/:id/results` | Admin, auditor, candidate, or assigned voter: closed results and audit |
| GET | `/api/admin/audit?before=123` | Admin: newest 50 administrative actions, with a pagination cursor |

Ballot status is `not_submitted`, `pending`, `confirmed`, or `failed`. A pending
submission returns HTTP 202; a mined receipt returns HTTP 200 with its actual
status. Clients must inspect that status rather than interpreting every 200 as a
successful vote. Input/authorization/conflict errors use 400, 401/403, 404, or 409;
ledger/configuration outages use 503. Sensitive API responses use `no-store`.

Election-local party/candidate writes are retired in favor of the registry.
Candidate, auditor, and party accounts can read election metadata without seeing
assigned voter lists.

## Remaining scope

- Optional challenge-response liveness service and its evaluation.
- Manual desktop/mobile browser QA and a recorded demonstration.
- Project report updates, performance measurements, and final presentation.
- Production deployment and formal anonymity are outside this prototype's scope.

## Implementation references

- [Ethers v6 transaction/provider documentation](https://docs.ethers.org/v6/single-page/)
- [Solidity contract source](blockchain/contracts/SecureVote.sol)
