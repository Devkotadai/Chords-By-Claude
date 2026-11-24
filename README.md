# Chords By Claude

Listens to a song (an uploaded audio file or the device microphone) and shows which chords are playing.

Live app: https://devkotadai.github.io/Chords-By-Claude/

## Saving songs to Notion (optional)

`api/save.js` is a small serverless function (built for Vercel's free plan). The web page sends each analysed song to it, and it appends the song to one long Notion page: song name, date, key, progression, chords by time, and lyrics if they were transcribed. The Notion key lives only in Vercel's environment settings, never in this repo or in the page. A passcode stops anyone else from writing to your page.

Environment variables to set in Vercel: `NOTION_TOKEN`, `NOTION_PAGE_ID`, `APP_PASSCODE`. Optional: `ALLOWED_ORIGINS` (defaults to the GitHub Pages site).

Run the function's tests with `npm test`.
