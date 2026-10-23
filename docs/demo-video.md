# Demo video: storyboard

A 3½-minute screen recording of the live demo, shot by shot. Narration lines are suggestions; say
them in your own words.

**The live site runs a real model** (Groq gpt-oss-120b, Gemini fallback; ADR-0021), so each take
can word things differently, and may take a slightly different route. The shots below were
rehearsed against the scripted mock, which is what the quoted outputs show. Two shots differ in
practice:

- **Shot 4:** the model may ask for the five writes one card at a time rather than all at once.
- **Shot 6:** the model often checks DS-42 _before_ writing. It then offers DS-7 straight as an
  approval card, so you see no error card, and that card is the confirmation.

Both are correct behaviour. For a take that matches this script word for word, record against a
local copy (`pnpm dev` with no keys runs the mock), or ask me to put the live site back on `mock`
while you record.

**Target length:** about 3:30. **Where it goes:** attached to the `v1.0.0` GitHub release, and
linked from the README.

## Before you record

- [ ] Open https://devsprint-web.eleo-666.workers.dev in a clean browser profile, so there are no
      extensions or bookmarks bar in shot. A 1920×1080 window at 100% zoom works well.
- [ ] Click **Reset board** in the header. Check the board reads **Committed 31 / Completed 8**.
- [ ] Light theme to start. You switch to dark once, in shot 4.
- [ ] Copy this file's prompts somewhere you can paste them from. Typing live is fine too: the
      mock matches on keywords, but pasting avoids typos on camera.
- [ ] For shot 7, add the MCP server to Claude Desktop **before** recording (see that shot). Start
      a fresh chat there.
- [ ] Turn on Do Not Disturb.

## Shots

### 1. Cold open (0:00–0:15)

**Screen:** the live board, idle. Slowly move the pointer across the columns, then to the chat.

> "This is DevSprint Copilot: an AI copilot for a sprint board. Every answer comes from real tool
> calls, every change waits for my approval, and the same tools are open to other AI assistants
> over MCP."

### 2. A grounded answer: S-D (0:15–0:40)

**Prompt:** `Is Sprint 12 on track? Show me the burndown.`

**Screen:** the burndown chart draws in, and an issue table shows DS-11. Hover the chart so its
day readout changes.

> "It doesn't guess. It fetched the burndown series, and the chart and the answer both come from
> that data: 8 of 31 points done, behind the ideal line, and DS-11 is the blocker."

### 3. A chain of tools, then a gated write: S-A (0:40–1:20)

**Prompt:** `Summarize Sprint 12 and draft release notes for v1.5.0.`

**Screen:** a tool chip for the sprint status, an issue table with DS-5 and DS-6, then the release-notes diff. Click
**Published** and then **Draft** on the diff card.

> "One question, three tools: sprint status, what shipped, and a diff of the draft against the
> last published notes."

**Prompt:** `Looks good, save it.`

**Screen:** an approval card appears. Pause on it for a beat, then click **Approve**. The card
records "Approved by you — applied", and the agent confirms the save.

> "Saving is a write, so nothing happens until I approve it. The card stays as the record of who
> allowed what."

### 4. Five writes, five decisions: S-B (1:20–2:05)

**Prompt:** `We're closing Sprint 12 today — mark every remaining open issue in the sprint as done.`

**Screen:** five approval cards, one per issue, and the composer locks. Approve the first four.
On the last (DS-11), type the reason `Still blocked on vendor sandbox` and click **Deny**. The
board on the left moves four cards to Done; DS-11 stays in Blocked. Click the theme toggle once
to show the dark theme.

> "It never batches writes. Each issue gets its own decision, and when I deny one with a reason,
> the agent says so instead of claiming the sprint is closed."

### 5. Long-running work: S-C (2:05–2:35)

**Prompt:** `Deploy v1.5.0-rc.1 to staging.`

**Screen:** approve the card. The deployment card streams build → test → migrate → release.
Optionally, run it a second time and click **Cancel** during `test`.

> "A simulated deploy that streams every stage as it happens, and cancel is a real cancel: the
> run on the server stops too."

### 6. Recovering from a mistake: S-E (2:35–3:00)

**Screen:** click **Reset board** first, so DS-7 is back in review. That also shows the reset.

**Prompt:** `Mark DS-42 as done — the billing export shipped this morning.`

**Screen:** approve. An error card shows `ISSUE_NOT_FOUND`, then a search table appears and the
agent asks: _Did you mean DS-7 "Billing export CSV download"?_

**Prompt:** `Yes, that one.`

**Screen:** a **new** approval card. Approve it, and DS-7 moves to Done on the board.

> "DS-42 doesn't exist. Instead of failing or guessing, it searches, asks what I meant, and the
> fix gets its own fresh approval."

### 7. Another AI client, the same board: S-F (3:00–3:25)

**Setup, before recording.** In Claude Desktop, add the server
`https://devsprint-mcp-issues.eleo-666.workers.dev/mcp` as a custom connector (Settings →
Connectors), if your plan offers remote connectors. Otherwise add it through `mcp-remote` in
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "devsprint": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://devsprint-mcp-issues.eleo-666.workers.dev/mcp"]
    }
  }
}
```

**Prompt (in Claude Desktop):**
`Create a DevSprint issue titled "Add CSV export progress indicator", type feature, medium priority, in the backlog.`

**Screen:** Claude Desktop asks permission for `create_issue`; allow it. Switch to the browser and
reload: **DS-14** is in the backlog.

> "This is Claude Desktop, talking to the same issue tools over MCP. Its permission prompt stands
> in for my approval card, and the write lands on the same board."

### 8. Close (3:25–3:35)

**Screen:** the repo README's architecture diagram, or the board.

> "Three Cloudflare Workers, one Durable Object, and every decision written down. The code and the
> ADRs are on GitHub."

## After recording

- Trim dead air. Keep each answer on screen long enough to read, about 2 seconds after the stream
  ends.
- Export H.264 MP4 at 1080p, ideally under 100 MB.
- Click **Reset board** on the live site, so the next visitor starts clean.
- Hand the file over, or put it in the repo root as `devsprint-demo.mp4` (gitignored). The release
  step attaches it to `v1.0.0`.
