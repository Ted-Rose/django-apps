# google_api

## Changelog
4. Removed the `tv_archive` and `bible_research` apps (with `/tv-arhivs`, `/bible/`, `/bible/verses`, the `tv_archive_content` table, and the `googletrans` dependency) — resolves security findings F8/F9
3. Endpoint `/gmail-to-audio?` trims boilerplate from eklase messages and hides message body by default
2. Endpoint `/twister` generates audio from text giving the user functionality to create Twister game bot who gives instructions for each player
1. Endpoint `/gmail-to-audio?` helps user to rethrieve his Gmail emails and read them in audio format

## ToDoList

1. text-to-audio endpoint should accept text as body not quqery parameter
2. text-to-audio endpoint should check if audio exists and if not create it

### Twister
1. Add functionality to input audio via microphone
