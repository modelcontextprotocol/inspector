# Retroactive DCO signoffs

Every commit in this repository carries a Developer Certificate of Origin
signoff (`Signed-off-by:`), checked by `.github/workflows/dco.yml`. The commits
listed below merged on 2026-08-11/12 without one, while the probot DCO app that
used to enforce this was suspended and nothing replaced it (#2566, #2616). They
are already on `main` and in released versions, so their history is not
rewritten. Instead each author certifies them here.

Each section below was added by its author in a commit that the author both
wrote and signed off. That commit is the author's retroactive `Signed-off-by:`
for every commit the section lists. To verify, run:

    git log --format='%h %an <%ae>%n%(trailers:key=Signed-off-by)' -- docs/dco-retroactive-signoffs.md

## cliffhall <cliff@futurescale.com>

I, Cliff Hall, am the author of the commits below. I certify that each of
them was contributed in accordance with the Developer Certificate of Origin,
version 1.1 (https://developercertificate.org/), and this signed-off commit
adds my `Signed-off-by: cliffhall <cliff@futurescale.com>` to each of them.

| Commit                                     | PR    | Subject                                                                                  |
| ------------------------------------------ | ----- | ---------------------------------------------------------------------------------------- |
| `eb5bba62ede2c27d9082a833bcf23e34d4cda2ee` | #1983 | fix(tui): bundle React-rendering deps so a consumer install can't split React            |
| `3c1bbbcb5fda7e4eb393f7323f1b347726ccc440` | #1983 | fix(tui): correct ink-form's misspelled incomplete-form hint                             |
| `39575ff060bcc7f4a7478a19d1d58ec568c39e2c` | #1983 | test(tui): drive the ink-form patch through the plugin, and drop the esbuild type import |
| `9fd5bc177cb9e40e651756c533fed14526043bc6` | #1983 | chore: drop the orphaned root override, and correct the TUI coverage note                |
| `94a227b9c12451ee7810f1177e4992ac4713742c` | #1983 | fix(tui): widen the root react range so an external ink can't split React                |
| `b70aed691418a7e2e98c897cba6ab44ad422f648` | #1987 | test(fix): probe a single-source route when waiting for the dead transport               |
