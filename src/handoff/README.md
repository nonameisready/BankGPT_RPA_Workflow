# Human handoff

`LiveSessionControlManager` tracks `automation`, `paused`, and `human` ownership for the same live surface session. The CLI handoff keeps a headed Playwright browser open while the operator acts, waits for an explicit resume signal, then lets replay re-observe before continuing.
