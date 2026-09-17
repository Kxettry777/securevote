# SecureVote development

## Implemented

SecureVote now supports the complete local voting workflow:

- Commission-controlled voter enrollment, voter-chosen passwords, login, expiring sessions, and administrator approval/revocation.
- Admin registration of political parties with symbol images and dedicated party sign-in accounts.
- An admin dashboard with live voter, party, and election counts, plus a dedicated voter list.
- Confirmed party deletion that disables party login and preserves saved elections and results.
- Party-owned candidate nominations, separate role hierarchies per party, and complete-roster submission.
- Admin voter enrollment with unique institutional IDs, immediate approval or pending review, and expiring single-use activation links.
- Permanent deletion of ended elections and confirmed deletion of individual or bulk audit entries.
- Election creation from 2 to 100 submitted party rosters, immutable ballot snapshots, and approved voter assignments.
- Administrator banner uploads with preview, replacement, removal, and protected image access.
- Server-aligned countdowns before and during voting on election cards, details, and ballots.
- Five-minute voting credentials, party selection, explicit ballot confirmation, and one vote per assigned voter.
- Solidity ballot recording on a persistent local Ganache ledger, with confirmed transaction receipts.
- Recovery of saved submissions after connection interruptions or an API restart.
- Results after the election ends, ties and zero-vote outcomes, transaction references, and downloadable JSON audit reports.
- Read-only election/results access for candidate and auditor roles. Only admins see assigned voter lists.
- An admin-only audit log for election, candidate, assignment, approval, and revocation changes.

AI facial liveness is deferred and is not part of the current milestone.
The frontend uses JavaScript and JSX; TypeScript compilation is not required.
The README remains the broader project proposal;
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

### Login, profile image, and admin dashboard

The login card is titled **Secure Vote**, with the introductory text, enrollment
footer, and routine sign-out message removed. Activation instructions and actual
authentication errors remain visible when needed.

Place the shared profile image at `frontend/src/assets/profile.jpg`. It appears
on the login page, sidebar, and signed-in account header, cropped to a circle. Until
the file is present, the interface shows a neutral profile icon. Rebuild the frontend
after adding or replacing the image for a production deployment.

Administrators land on **Dashboard** after login or session restoration. The
dashboard shows voter totals, pending approvals and activations, registered
parties, submitted rosters, and upcoming, active, and completed elections. Use
**Voter list** to search voters, approve/revoke access, or replace activation links.
The dashboard's quick actions also open voter enrollment, party management,
election creation, and the audit log. `GET /api/admin/dashboard` requires an admin.

### Party elections, banners, and countdowns

Use the sidebar in this order:

1. **Registered parties → Register party** (admin): enter the party name, abbreviation,
   and manifesto, then choose an election symbol from the visual gallery.
   Its name and image are saved together. Existing uploaded symbols can be kept
   when editing a party. Supply a unique party email and initial password. The account, hashed
   password, party, default roles, and audit entry are saved together. Share the
   credentials with the intended representative outside the app; no email is sent.
   Public voter registration is disabled. Voters activate commission-enrolled accounts.

   Symbol choices come from `GET /api/registry/symbols`; create/update requests
   submit `symbolId`. The backend uses the corresponding catalog name and image,
   ignoring conflicting client-supplied names or images. The older image-upload
   API remains compatible with existing clients. Catalog artwork is derived from
   Font Awesome Free; attribution is in `backend/media/ELECTION_SYMBOLS_LICENSE.txt`.
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
  `shortName`, `symbolId` (from `GET /api/registry/symbols`), `manifesto`, `email`,
  and `password`. The selected catalog entry supplies both the symbol name and
  image. Legacy clients may instead supply `symbol` and `symbolImage` (image data
  URL). `PATCH /api/registry/parties/:id` edits party identity and optionally
  replaces its symbol; omit `symbolId` and `symbolImage` and supply the current
  `symbol` name to keep an existing image. It does not change account credentials.
- `POST/PATCH /api/registry/roles[/:id]`: admin supplies `partyId`, `name`, and
  integer hierarchy `rank` (1–100). Names and ranks are unique within that party.
  A nomination cannot use a role owned by another party.
- `POST/PATCH /api/registry/candidates[/:id]`: party supplies `partyId`, `roleId`,
  `fullName`, `biography`. Ownership is verified on the server for every write.
- `DELETE /api/registry/candidates/:id`: party removes its own nomination.
- `POST /api/registry/submit`: party submits its complete roster.
- `POST /api/elections`: admin supplies existing schedule fields plus `partyIds`
  (2–100 distinct registered, submitted parties). Creation is atomic.

The former election-local party/candidate mutation endpoints now reject edits
with 409. Existing read aliases and contract identifiers remain compatible.
Banner routes remain `PUT/GET/DELETE /api/elections/:id/banner`. Party accounts
can view elections/results but cannot create elections, assign voters, access the
admin audit log, or cast votes. Ballots still accept `{ partyId, credential }`.

After updating, run `npm.cmd --prefix backend run db:setup` and restart the backend
and local chain. The root `npm.cmd run dev` command performs setup for you when
those services are not already running separately. Keep using the existing ledger.

### Admin account and history management

- In **Registered parties**, choose **Delete party**, review the confirmation,
  and type `DELETE`. The party disappears from the registry and future election
  selection, and its account loses both login and existing-session access.
  Saved ballots, candidates, votes, results, and audit history remain intact.
  Deletion does not withdraw a party from an already-created election. The party
  name and account email remain reserved for historical consistency. There is no
  restore control in the current UI.
- **Register voter** opens a dedicated form for a full name, verified email,
  unique institutional ID, and approval status. Confirm the identity check against
  the official roster, then privately share the generated activation link. The
  voter sets their own password. The admin can approve immediately or leave the
  account pending. This endpoint always creates a voter, regardless of submitted
  role fields. Activation, approval, and election assignment are required before
  voting.
- In **Elections**, **Delete election** is available for ended elections. Type
  `DELETE` to permanently remove the election, ballot snapshots, voter assignments,
  banner, credentials, and local transaction records. There is no removed-election
  list or restore action. Upcoming/active elections cannot be deleted, and pending
  ledger transactions must be reconciled first by refreshing results. Registered
  parties, voter accounts, administrative audit events, and confirmed blockchain
  transactions remain. Deleted elections and their results are unavailable in the app.
- In **Audit log**, admins can delete a single entry or clear all history up to
  their most recent loaded snapshot. Both actions require typing `DELETE`.
  Deletion is permanent. New activity after the snapshot is retained, and clearing
  audit history does not delete elections or recorded votes.

API additions: `POST /api/admin/voters` (`fullName`, `email`, `institutionalId`,
`isApproved`), `POST /api/admin/voters/:id/activation` (replace an unused activation
link), `DELETE /api/elections/:id` (body `{ confirmation: "DELETE" }`),
`DELETE /api/admin/audit/:id` (body
`{ confirmation: "DELETE" }`), and `DELETE /api/admin/audit` (body
`{ confirmation: "DELETE", throughId }`, using `latestId` from the audit list).
All require an administrator account.

For an existing installation with elections removed by the older version, run:

```powershell
node backend/scripts/purge-removed-elections.js --confirm=DELETE
```

This permanently deletes only previously removed elections, using the same
transactional deletion and pending-ledger checks. It can be rerun safely. Normal
database setup does not delete elections. The legacy marker table remains for
upgrade compatibility; its entries stay hidden until cleanup is complete.

Party deletion uses `DELETE /api/registry/parties/:id` with body
`{ confirmation: "DELETE" }`. The additive `025_deleted_parties.sql` migration
records deletion without removing rows referenced by election snapshots. Registry
edits and snapshot creation lock and recheck the party, and deletion is audited
atomically. Run `npm.cmd --prefix backend run db:setup` and restart the backend
when updating an existing installation. The migration has been applied locally.

Database setup now migrates existing global role definitions and nominations into
party-specific tables in a transaction. Candidate IDs and submitted rosters are
preserved. A migration marker prevents later setup runs from overwriting party
customizations. Existing election snapshots are unchanged. Restart the backend
with the updated code after applying `npm.cmd --prefix backend run db:setup`.

### Walk through a vote

1. As admin, open **Register voter**, enter the voter's name, verified email, and
   unique institutional ID. Choose **Awaiting approval**, confirm the roster check,
   and enroll. Privately share the generated activation link with the voter.
2. Open the link in a separate session and set a password. Confirm that login remains
   blocked until the admin approves the account in **Voter list**.
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

Candidate/auditor accounts are supported by the API and frontend. Provision their
roles through a trusted local administrator/database workflow. Voter enrollment
and activation never grant elevated roles.

### Voter enrollment and activation

Only an authenticated admin can enroll voters through `POST /api/admin/voters`.
Supply `{ fullName, email, institutionalId, isApproved }`; the endpoint rejects an
admin-supplied password. Institutional IDs are trimmed, normalized to uppercase,
and unique across new enrollments. They accept 2–64 ASCII letters, numbers, dots,
slashes, underscores, or hyphens, starting with a letter or number. Admins must
verify identity and eligibility against the official institutional roster.

Enrollment returns `{ voter, activation: { token, expiresAt } }`. The UI builds a
link using the current site's origin and `#activate=<token>`. Share this privately
through a verified contact channel. **No email is sent automatically.** Use a site
address reachable by the voter; a localhost link only works on the same computer.
The raw activation token is shown only when issued, kept in component memory,
and never included in voter lists or audit logs. The database stores its SHA-256
hash. Links expire after 24 hours. The activation page removes the token from the
address bar; after a refresh, reopen the original link to continue.

`POST /api/auth/activate` accepts `{ token, password }`, hashes the voter-chosen
password, and atomically consumes the token. It never approves the account or
assigns elections. Expired, replaced, and used tokens are rejected. The voter
then signs in normally after commission approval. From **Voter list**,
admins can create a replacement using `POST /api/admin/voters/:id/activation`;
this invalidates the previous link and works only for unactivated enrollments.
This endpoint cannot reset an activated account's password.

`POST /api/auth/register` now returns 403. Existing accounts retain their passwords,
approval, and election access; they are not forced through activation. Their
institutional ID is displayed as not recorded. Duplicate-ID enforcement applies
to the new enrollment records; existing identities still need manual roster checks.
Enrollment, approval, link replacement, and activation have audit records.

Apply the additive `024_voter_enrollments.sql` migration with
`npm.cmd --prefix backend run db:setup`, then restart the backend. The full
`npm.cmd run dev` launcher also applies this migration. AI identity checks, roster
imports, and automatic invitation delivery remain future work.

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
checks, ESLint checks for JavaScript/JSX and React hooks, and a production frontend build.

Integration tests create uniquely named `securevote_test_*` databases and remove
only those databases afterward. They do not modify the application database.
The test account needs CREATE and DROP DATABASE permissions. The blockchain test
runs its own disposable in-memory ledger and deployment on a random loopback port.

Checks cover authorization, schema reruns, persistence, unique eligibility,
transactional administrative auditing, locked elections, invalid candidates,
credential rotation/expiry, credential theft between accounts, revocation,
concurrent duplicate submissions, interrupted broadcast recovery, mined failure
and explicit retry, closed results, privacy of API responses, and ledger mismatch
rejection. Enrollment checks also cover duplicate institutional IDs and rollback,
unactivated account access, expired/replaced activation links, concurrent single-use
activation, approval separation, and exclusion of tokens from voter lists. Symbol
checks cover catalog selection, mismatched client names/images, unknown choices,
replacement, and preservation of existing images. Browser visual/interaction
verification still needs the manual demo above because no browser automation
surface was connected during verification.

Latest verification (2026-09-17): all 55 backend test cases passed (18 unit/HTTP/
contract cases and 37 MySQL/HTTP/ledger integration cases). All checks used by
`npm.cmd run check` passed, including ESLint with zero warnings. The JavaScript/JSX
production frontend build passed. The added checks cover dashboard authorization
and counts, deletion confirmation, rollback when auditing fails, disabled party
sessions, and preservation of election snapshots and confirmed blockchain results.
Permanent election deletion checks also cover pending-transaction protection,
atomic rollback, dependent-row cleanup, all-role access removal, dashboard counts,
repeatable legacy cleanup, and unchanged confirmed blockchain transactions.
All 12 catalog symbols have unique IDs and
valid WebP images. The running application database includes the enrollment
migration, and the running API returns 403 for public registration.
The running Vite server also serves the JSX entry and converted application modules,
and its API proxy reports a connected database. This HTTP smoke check does not
replace the browser visual/interaction checks described above.
The running API also passed an administrator login and dashboard request after
the party-deletion migration was applied. The profile photograph is supplied by
the site owner and was not present during these checks.
The two previously removed local elections have been permanently deleted and
verified absent. The running API rejects the retired removed-election filter,
and Vite serves the updated profile placeholder.
The frontend now uses ESLint 10 instead of the native Oxlint binary that Windows
Application Control blocked. No Windows security settings were changed. The
TypeScript compiler, TypeScript configuration files, and direct type-package
dependencies have been removed; `jsconfig.json` provides JavaScript editor support.

To run checks separately:

```powershell
npm.cmd --prefix backend test
npm.cmd --prefix backend run test:mysql
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
```

## API additions

All endpoints require a valid session. Voter endpoints also require current
approval and election assignment.

| Method | Route | Access / behavior |
| --- | --- | --- |
| POST | `/api/elections/:id/credentials` | Voter: rotate a short-lived voting token |
| POST | `/api/elections/:id/ballots` | Voter: submit `{ partyId, credential }`; returns a receipt/status |
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

- Deferred: optional challenge-response liveness service and its evaluation.
- Manual desktop/mobile browser QA and a recorded demonstration.
- Project report updates, performance measurements, and final presentation.
- Production deployment and formal anonymity are outside this prototype's scope.

## Implementation references

- [Ethers v6 transaction/provider documentation](https://docs.ethers.org/v6/single-page/)
- [Solidity contract source](blockchain/contracts/SecureVote.sol)
