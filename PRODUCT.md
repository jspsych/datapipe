# Product

## Register

product

## Users

Behavioral scientists — psychology, cognitive science, linguistics, education —
running online experiments (usually jsPsych) and needing the resulting data to
land somewhere durable and citable without standing up a server.

They are domain experts, not web developers. Many are graduate students or
postdocs configuring this once for a study that will then run unattended for
weeks. Their technical confidence varies enormously: some write their own
plugins, others are pasting a snippet from a tutorial.

Two states of mind bring someone to the account settings page:

- **First-time setup.** A new signup cannot create an experiment until a
  storage provider is connected. Settings is a *required step in activation*,
  not a maintenance screen — the researcher is here because the product sent
  them here, and they are blocked until they finish.
- **Rare maintenance.** An established user returning once every few months to
  rotate an expired token, change a password, add a sign-in method, or
  disconnect a provider. They have forgotten how this page works. Nothing here
  is muscle memory.

Neither persona visits often. Nothing on this page can rely on recall.

## Product Purpose

DataPipe is free, grant-funded infrastructure that accepts data from a running
experiment over a simple HTTP API and writes it to a repository the researcher
controls (Google Drive, Dataverse, Zenodo; OSF historically). It exists so that
"born-open data" is the path of least resistance rather than a project in
itself.

Success is invisibility: an experiment collects for six weeks and every
participant's data arrives, without the researcher logging in once. The product
is working when nobody thinks about it.

That inverts the usual attention economics. Because the researcher is almost
never looking, the interface's real job is to make the *consequential* states —
a token about to expire, a provider not connected, a sign-in method that would
lock them out — legible in the few seconds of attention it ever gets.

## Brand Personality

**Trustworthy, plain, unfussy.**

Infrastructure that stays out of the way. Calm and legible; no marketing
energy, no persuasion, no celebration. The voice states what is true and what
will happen next, in the researcher's own vocabulary, without hedging or
jargon. Confidence is expressed through precision and through never losing
data — not through visual assertiveness.

Emotional goal: quiet certainty. A researcher should leave this interface
believing their data is safe, and should be able to say exactly where it went.

## Anti-references

- **SaaS growth-marketing UI.** No gradient hero metrics, upsell nudges,
  engagement prompts, confetti, or celebratory language. This is grant-funded
  academic infrastructure, not a conversion funnel. Nothing on screen should be
  trying to get the researcher to do more of anything.
- **OSF's own interface.** The tool being migrated away from. Do not inherit
  its density, deep nesting, or navigational ambiguity.
- **Enterprise admin console.** No sprawling nav trees, role matrices, or dense
  configuration tables. One researcher owns one account; the IA should say so.
- **Playful / consumer app.** No mascots, illustrated empty states, emoji, or
  animated flourishes. Wrong register for a tool holding irreplaceable research
  data.

## Design Principles

1. **Assume no recall.** Every visit is effectively a first visit. Labels,
   states, and consequences must be readable cold, without memory of a previous
   session or of documentation read months ago.
2. **Consequence before mechanism.** Say what will happen to the researcher's
   data and access first; explain the machinery second, and only if it helps
   them act. "Your experiments stopped sending data" beats "refresh token
   expired."
3. **Never strand a researcher.** Destructive or lock-out-adjacent actions —
   unlinking a last sign-in method, disconnecting a provider mid-study,
   deleting an account — must be prevented or explained in terms of what is
   lost, never merely confirmed.
4. **Legibility over density.** A page glanced at twice a year earns its space
   by being scannable, not by fitting more in. Status is a first-class citizen,
   not a decoration on a row.
5. **Practice what you preach.** DataPipe argues for open, careful data
   handling. The interface should visibly embody that care — accurate states,
   honest errors, no silent failures.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**.

- Body text ≥4.5:1 against the permanently dark `#1C1F22` surface; large text
  and non-text UI boundaries ≥3:1. `lib/theme.js` already re-points the gray
  palette for the dark surface with measured ratios — hold that line.
- Status must never be conveyed by color or icon alone; every state needs a
  text equivalent.
- Full keyboard operability with a visible focus ring on every interactive
  element, including icon-only and link-styled controls.
- Honor `prefers-reduced-motion` for any motion added.
- Users span a wide age range and include international researchers reading
  English as a second language; favor plain vocabulary over idiom.
