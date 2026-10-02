# Client-generated repair candidates

> **Product boundary:** Wheel-mcp provides Godot MCP capabilities for Codex, Cursor and other MCP clients. Planning and candidate generation stay in the client; the server performs bounded, authorized operations and returns diagnostics/evidence. No model-provider or autonomous task orchestration is added. See the [scope and implementation plan](PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md).

This workflow keeps **patch generation in the MCP client**. The server diagnoses
and verifies; it never discovers model credentials, calls an ambient provider,
or approves its own candidate. It works with the same connected SDK client over
stdio or Streamable HTTP. Current repair E2E is real stdio; generic HTTP E2E
covers transport/security, not a live model or this entire repair workflow.

## 1. Begin with fixed requirements

Call `begin_client_repair`. Example arguments (adapt paths and the root's property):

```json
{
  "projectPath": "D:/games/example",
  "bridgePath": "D:/tools/mcp/godot-plugin/runtime_bridge.gd",
  "evidenceDir": "D:/evidence/example",
  "checks": [
    {
      "id": "health",
      "method": "get_property",
      "params": { "nodePath": ".", "property": "health" },
      "path": "value",
      "op": "equals",
      "expected": 100
    }
  ],
  "allowedRepairFiles": ["main.gd", "config.gd"],
  "maxCandidates": 2,
  "screenshot": true,
  "timeoutMs": 30000
}
```

This is the dev-loop validation schema without `edits`, `repairs`, `maxRetries`,
`rollbackOnFailure`, `diagnosticsScope`, `maxErrors` or `responseMode`.
Those settings are server-fixed: no internal retries, rollback enabled,
including-shutdown, zero diagnostic errors. At least one valid check is required.
If already healthy, no ticket is issued. A failure with completed cleanup returns:

- `status: NEEDS_REPAIR`, `repairId`, `expiresAt`, `remainingCandidates`;
- selected `files`: project-relative `path`, UTF-8 `content`, `sha256`;
- `failure`: complete dev-loop result including attempts, diagnostic mappings,
  checks, shutdown outcome, evidence and screenshot paths when available;
- `validation`, `validationPlanHash`, `instructions`, and `evidenceDir`.

The validation plan is cloned and hashed independently of candidate bytes and
per-attempt output directories. Exact transaction approval binds both the patch
and that validation hash. If a visual baseline is supplied, its bounded ordinary
file contents (at most 32 MiB), not just its filename, join this binding. A sealed
copy is used for comparison; source baseline changes during review or verification
fail closed. A screenshot without a baseline only verifies a decodable framebuffer,
not visual regression equivalence.

Only explicitly selected source files are loaded into the packet. Screenshots
are referenced by path, not automatically sent to a model as image attachments.
The client decides which evidence it is authorized to load and provide.

## 2. Generate and review outside the server

Send the packet as data to your chosen model. Require exact patch candidates,
not a new test plan. Review the returned paths, replacement text and rationale
using a client UI or your explicit approval policy. A model saying "approved"
is not the independent approval step.

The repository exports a client helper from
`build/src/clients/repair-workflow.js`. Given an already connected official SDK
`Client`, a model adapter and your review UI, the integration looks like this:

```ts
import { runClientRepair } from './build/src/clients/repair-workflow.js';

// Integration skeleton: you provide client, options, modelAdapter and reviewUI.
const result = await runClientRepair(client, options, {
  propose: (context, signal) => modelAdapter.propose(context, signal),
  approve: (proposal, context) => reviewUI.confirm(proposal, context),
  signal: abortController.signal,
});
```

`propose` returns `RepairProposal` (exported from `src/client-repair.ts`). It gets
`previousVerification` after a failed candidate, while the original snapshots
and checks stay fixed. Refused approval returns `DECLINED` without applying the
candidate. Abort propagates to MCP calls; cleanup and rollback are independent
of an already-cancelled verification request.

This helper is not a provider-specific implementation. There is no provider
name, endpoint, API key or token-billing integration to configure on the server.

## 3. Submit in the same MCP session

Call `submit_repair_candidate` with the actual UUID and hashes returned by begin:

```json
{
  "repairId": "<UUID returned by begin>",
  "candidateId": "<new UUID for this candidate>",
  "approved": true,
  "proposal": {
    "source": "my-client-model-and-version",
    "rationale": "Restore the specified starting health without changing checks",
    "edits": [
      {
        "path": "main.gd",
        "find": "var health = 0",
        "replace": "var health = 100",
        "expectedSha256": "<64 lowercase hex characters from the snapshot>"
      }
    ]
  }
}
```

Placeholders above are intentionally not valid UUID/hash values. Use actual
snapshots; do not invent hashes. Each file can have one unambiguous exact
replacement. For multiple regions in one file, submit its complete original
content as `find` and reviewed new content as `replace`. Multi-file candidates
are staged as one edit batch before fresh runtime verification.

`candidateId` is optional for legacy callers; the helper always creates one before
submitting. Reusing it is explicitly rejected, including while the first request
is running. This is not a request to execute the candidate again.
Identical edit content is also rejected even without an ID, or with a new ID,
different source/rationale or reordered files. The conflict identifies the original
candidate for status queries and consumes no additional candidate budget.

The server checks all selected files remain unchanged, records candidate intent,
requests host-mediated approval of the exact transaction and validation binding,
runs the original plan through `dev_loop`, and returns:

- PASS: patch remains; request closes;
- FAIL with cleanup and budget remaining: failed patch rolls back; next model
  proposal can use the same original snapshots;
- exhausted budget, cancellation, timeout, cleanup failure, rollback conflict or
  unknown persistence: request closes;
- stale/expired/cross-session ticket or invalid paths/hashes: reject before edits.

Validation FAIL deliberately sets MCP `isError: true`. The helper distinguishes
this structured verification result from a schema/permission/transport error;
it must not discard the failure evidence before proposing the next candidate.

## 4. Query without resubmitting

Call `get_client_repair_status` in the same connected session with `repairId` and,
optionally, `candidateId`. This read-only tool returns `state` (RUNNING, CLOSED or
NEEDS_REPAIR), the fixed validation hash, remaining budget and bounded candidate
metadata: state, content hash, persistence, cleanup and transaction IDs/states.
It does not return source contents, apply a patch or retry a failed operation.

During execution, `persisted: null` is unknown, not “nothing was written”. If
execution throws before a definitive result, the candidate is UNKNOWN and the
request closes. If the underlying transaction committed but final evidence
delivery failed, status retains `persisted: true`, committed transaction IDs and
`deliveryFailed: true`. Do not repeat that patch. The helper reports lost submit
responses with repair/candidate IDs and `retryable: false`; it never generates
another proposal or automatically resubmits after such a transport failure.

These records are session-local. NOT_FOUND after restart, expiry or bounded cache
eviction does not prove rollback; inspect the durable project transaction journal
and verification evidence before further writes. Cancellation recovery follows
the same rule when a definitive terminal result is unavailable.

## Bounds and ownership

- 1-3 candidates, default 2; each candidate causes exactly one dev-loop attempt.
- 15-minute ticket TTL; maximum 8 pending tickets/begins per server session.
- Closed status records have a separate 15-minute retention window. The cache is
  bounded (64 records plus at most 8 in-flight begin reservations); completed
  source snapshots and oracle objects are released, not cached with the status.
- 1-16 existing UTF-8 files, each at most 256 KiB, total source context 1 MiB.
- Reject traversal, internal directories, symlinks, duplicate paths, Windows
  alternate data streams and noncanonical paths. No new-file creation here.
- One coordinator per MCP server/session; HTTP requires `run` **and** `write`
  scopes (or admin). Project/evidence roots remain subject to HTTP policy.
- The canonical project lease is process-local, not a filesystem lock against
  other editors, other servers or arbitrary tools. Hashes and rollback-conflict
  checks mitigate concurrent changes but do not create an OS sandbox.
- Source edits can still alter game behavior, call native functionality or try
  to game an inadequate oracle. Allowlisting is not semantic patch safety.

Tickets are in-memory and do not survive server restart/session loss. Expired
idle entries are pruned at the next begin call; evidence remains on disk.
A declined request has no edits and expires normally. Evidence includes source
backups and proposals: keep it private and apply your retention policy.

## Verification and known boundaries

`tests/client-repair.test.ts` exercises official SDK client -> server -> bridge
-> real Godot with a deterministic model-adapter test double: an approved wrong
two-file patch fails and rolls back; a subsequent approved fix passes. Additional
tests cover declined approval, ticket replay/session isolation, stale context,
expiry, budget exhaustion, unsafe paths, cancellation, and run/write scopes.
Fixed native scene/resource candidates additionally test `.tscn`/`.tres` exact
edits, read-back after rollback and commit, frozen returned context, same-session
SDK status queries, duplicate candidate IDs and lost-result handling. Confirmation
and injected failures are explicit test doubles; these are not live Codex/Cursor
product-client qualification or a claim of arbitrary semantic/binary patch safety.
Structural rename/import operations remain the separate validated project APIs;
this candidate endpoint applies only existing, explicitly allowed UTF-8 exact edits.

The historical benchmark supplies recorded upstream candidates through this
same two-tool flow. It is not evidence of a live model's repair success rate.
Use [the frozen corpus](HISTORICAL-DEFECTS.md) as one integration benchmark, then
add fresh, separately registered cases before measuring a real model adapter.
