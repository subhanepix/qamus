# Future ideas

Ideas worth doing later. None of these are planned or started.

## Faster word capture while reading

Qamus is mostly used for looking up words while reading, with study about 20% of the time. Saving a word is quick, but the context sentence has to be copied from the other app and pasted by hand.

- **Read screen.** Paste a passage once, then tap any word to look it up. Saving fills in the context sentence and the exact form you tapped. This reuses the tap-to-look-up code that already runs inside definitions. It only helps if most reading is digital text.
- **Keep the searched form.** When you look up an inflected form, such as يكتبون, and save the root entry, store the form you searched as the card's highlight so "In the text" still works.
- **Paste button on the context field.** One tap to paste the clipboard into the save sheet's context field.

## Sync capacity

Sync now stores accounts in D1 (about 100,000 writes a day on the free plan, one per sync), so capacity is in the thousands of daily users.

- **Workers Paid ($5/month).** Raises the D1 and Worker limits further, with no code change. Only worth it if Qamus grows well beyond that.
- **A custom domain.** Put a real domain (e.g. from Cloudflare Registrar, about $10–20 a year) in front of the Pages project `alqamus`: add it under the project's Custom domains, add it to `ALLOWED_ORIGIN`, and update `NEW_HOME` in `app.js`.
