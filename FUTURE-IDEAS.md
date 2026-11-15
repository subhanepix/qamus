# Future ideas

Ideas worth doing later. None of these are planned or started.

## Faster word capture while reading

Qamus is mostly used for looking up words while reading, with study about 20% of the time. Saving a word is quick, but the context sentence has to be copied from the other app and pasted by hand.

- **Read screen.** Paste a passage once, then tap any word to look it up. Saving fills in the context sentence and the exact form you tapped. This reuses the tap-to-look-up code that already runs inside definitions. It only helps if most reading is digital text.
- **Keep the searched form.** When you look up an inflected form, such as يكتبون, and save the root entry, store the form you searched as the card's highlight so "In the text" still works.
- **Paste button on the context field.** One tap to paste the clipboard into the save sheet's context field.

## Sync capacity

The free Cloudflare plan allows 1,000 KV writes a day, and each sync makes one write. That's about 30–60 active users a day.

- **Sync history less often.** Push history changes when the app goes to the background instead of about 2 seconds after each search. Vocab and study changes still sync within 2 seconds. This would roughly double capacity again.
- **Workers Paid ($5/month).** Includes 1 million KV writes a month, enough for roughly 500–1,000 active users a day. Only worth it if Qamus grows beyond friends.
