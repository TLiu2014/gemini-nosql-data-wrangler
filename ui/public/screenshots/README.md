# Docs screenshots

These images are served as static assets at `/screenshots/<file>.png` and are
referenced by the **Visual trace timeline** section of the `/docs` page
(`ui/src/pages/DocsPage.tsx`). Until a file is present, the docs page renders a
labeled dashed placeholder in its place — nothing breaks if a screenshot is
missing.

Capture these from the running workspace (`/app`) — ideally light theme, a
~2x / Retina screenshot cropped tight to the chat panel:

| File | What to capture |
|---|---|
| `visual-trace-timeline.png` | The whole chat panel mid/after a turn: the violet "Thinking…" pill, one or more tool progress/result cards, the agent's reply bubble, and the suggestion chips underneath. Wide crop. |
| `trace-progress-pill.png` | A single in-progress tool call (`tool_call_start`) — spinner + tool name + truncated args. |
| `trace-result-card.png` | One finished tool call (`tool_call_result`), expanded — green ✓, tool name, duration in ms, and the response disclosure open. |
| `trace-suggestion-chips.png` | The 2–3 follow-up suggestion chips rendered below an agent reply. |

Keep them reasonably small (PNG, ≲ 400 KB each). The page lazy-loads them.
