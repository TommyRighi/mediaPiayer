# MediaPiayer — Future Feature Prompts

Each section is a self-contained prompt you can feed to an AI assistant to implement the feature on top of the existing codebase.

---

## 1. Subtitle Support

```
Add subtitle support to the video player. Allow users to upload .srt/.vtt subtitle files
when adding media or through the media detail page. The HTML5 <video> player should show
a subtitle track selector. Store subtitles in a new `subtitles` table (id, media_id, 
episode_id?, language, file_path) and serve them as static files.

Backend: Add a new route POST /api/media/:id/subtitles that accepts multipart upload
of subtitle files with a language field. Add GET /api/media/:id/subtitles to list them.
Store files in media/subtitles/. Add a `<track>` element to the video player component.

Frontend: In MediaDetailPage, add a "Subtitles" section. In WatchPage and PartyRoom,
use the HTML5 `<video>` element's TextTrack API to let users select subtitle tracks.
```

## 2. Watch Party Chat

```
Add a real-time chat to the watch party room. Use the existing WebSocket connection on
/api/parties/:id/ws to send/receive text messages. Show messages in a sidebar or overlay
on the video player. Store messages in a `party_messages` table (id, party_id, user_id,
text, created_at). Show the last 50 messages when joining a party, fetched via a GET
/api/parties/:id/messages route. Include timestamps and user display names.

WebSocket message format addition:
{ type: "chat", text: "Hello!" }
→ broadcast: { type: "chat", text: "Hello!", userId: "...", displayName: "...", timestamp: "..." }
```

## 3. Dark/Light Mode Toggle

```
Add a theme toggle to the navbar Layout component. Use Tailwind's dark mode class strategy
(class-based, not system-based). Store the preference in localStorage and apply on load.

Light theme color scheme:
- Background: #ffffff
- Surface cards: #f5f5f5
- Text: #141414
- Secondary text: #666666
- Accent: #cc0a14 (darker red)
- Navbar: white with subtle shadow

Add a sun/moon icon toggle button next to the user avatar in the navbar.
Transition the theme smoothly using CSS transitions on the body/html.
```

## 4. Keyboard Shortcuts in Player

```
Add keyboard shortcuts to the video player (WatchPage and PartyRoom):

- Space: play/pause
- Left Arrow: seek -10s  
- Right Arrow: seek +10s
- Up Arrow: volume +10%
- Down Arrow: volume -10%
- F: toggle fullscreen
- M: toggle mute

Show a small tooltip overlay the first time a shortcut is used per session
(store a 'shortcutsShown' flag in localStorage). 

In watch party mode (PartyRoom), disable playback shortcuts (Space, arrows) since
playback is server-controlled. Only keep volume/fullscreen shortcuts active.

Use a useEffect with a keydown event listener attached to the window.
```

## 5. User Roles: Admin vs Viewer

```
Add user roles to the app. Add a 'role' field to the users table (TEXT, default 'viewer',
options: 'viewer', 'admin'). Update the auth middleware to attach the role to request.user.

Rules:
- Only admins can access /admin, upload media, edit/delete media, trigger folder scans.
- Viewers can browse, watch, create/join parties, manage their own profile.
- The first registered user in a fresh database is automatically an admin.
- The API routes for protected actions (upload, PATCH/DELETE media, admin scan) should
  check request.user.role === 'admin' and return 403 if not.

Frontend: Show admin links (navbar Upload/Admin, edit/delete buttons) only when
user.role === 'admin'. In MediaDetailPage, hide edit/delete buttons from viewers.
```

## 6. Media Recommendations Row

```
Add a "You Might Like" row on the BrowsePage. Simple algorithm:
1. Find the user's most-watched genre (from watch_progress joined with media).
2. Fetch media with the same genre that the user hasn't completed.
3. Exclude items already in "Continue Watching".
4. If no watch history exists, show the most recently added media.

Display as a MediaRow with the title "You Might Like", positioned after "Continue Watching"
and before "Movies". The recommendation should update when the user navigates back to
the browse page (re-fetch on mount).
```

## 7. Mobile Responsive Layout

```
Make the frontend fully responsive using Tailwind responsive classes (sm:, md:, lg:).

Breakpoints:
- < 640px (mobile): 
  - Navbar: fixed bottom tab bar with icons (Home, Upload, Profile) instead of top nav.
  - Hero banner: height reduced to 50vh, title smaller (text-2xl).
  - MediaCard: w-[140px] instead of w-[180px], 2 per visible row.
  - MediaRow: horizontal scroll with snap points.
  - Video player: full-width, controls always visible.
  - Upload page: full-width inputs, no max-w constraint.
  - Media detail: poster on top, info below (stacked layout).
  - Party room: hide member sidebar, show expandable overlay instead.

- 640px-1024px (tablet): 3-4 posters per row, medium adjustments.

- > 1024px (desktop): current layout (unchanged).

Test all pages with responsive viewport sizes.
```

## 8. Series Auto-Detection from Folder Structure

```
Enhance the admin folder scanner (server/routes/admin.js scanMediaFolder function) to
detect series automatically from this directory structure:

/media/series/
  ShowName/
    Season 01/
      Episode_01_Title.mp4
      Episode_02_Title.mp4
    Season 02/
      Episode_01_Title.mp4

Logic:
1. Walk /media/series/ subdirectories (each is a show).
2. If show doesn't exist in DB: create a media row (type: 'series').
3. Walk "Season XX" subdirectories, parse season number from regex (\d+).
4. For each video file, parse episode number from regex (\d+) or use position in folder.
5. Extract title from filename: strip extension, replace separators with spaces.
6. Skip files that already exist in episodes table (match by file_path).
7. Return counts: { series, episodes }.

Remove any hardcoded test data or placeholder folder structure assumptions.
```

## 9. Offline Warning Banner

```
Show a banner at the top of the app when the browser loses internet connectivity.

Implementation:
- In Layout.jsx, add a state-based banner that appears when offline.
- Detect connectivity via navigator.onLine + periodic fetch to /api/auth/me (every 30s).
- Banner text: "Connection lost — trying to reconnect..."
- Style: yellow/amber background (#e6a817), dark text, full-width, 36px height.
- Auto-dismiss when connection returns (successful fetch to /api/auth/me).
- While offline: disable all navigation links and play buttons, show tooltip "You're offline".
- Use a custom hook useOnlineStatus() that returns boolean + recheck function.

Components to update:
- Layout.jsx (add banner)
- BrowsePage, MediaDetailPage (disable play buttons when offline)
```

## 10. Parental Controls (PIN)

```
Add optional PIN protection for specific media items.

Backend:
- Add pin_required INTEGER DEFAULT 0 to media table.
- Add pin TEXT to users table (4-digit, bcrypt hashed).
- Add PATCH /api/auth/pin route (body: { pin }) to set/change PIN.
- Add POST /api/media/:id/unlock route (body: { pin }) to verify PIN and return a
  temporary unlock token (JWT with mediaId + userId, expires in 4 hours).
- GET /api/media/:id/video and GET /api/episodes/:id/video should check:
  if media.pin_required AND user.role !== 'admin' AND no valid unlock token → return 403.

Frontend:
- In MediaDetailPage: if media.pin_required, show a lock icon on the poster.
- Clicking Play on a PIN-protected item shows a PIN input modal (4 digits).
- On correct PIN, store the unlock token and proceed to WatchPage.
- Admin users bypass PIN entirely (video plays directly).
- ProfilePage: add "Set Parental PIN" section (4-digit input, confirm input, save button).
```

---

## Implementation Notes

Each prompt is self-contained. Provide the AI:
1. The full codebase context (all files in server/ and frontend/)
2. One feature prompt from above
3. Instruction: "Implement this feature on top of the existing codebase. Maintain code style, 
   use existing patterns (Fastify routes, React functional components, Tailwind classes)."

The features should be built in order — later features may depend on earlier ones
(e.g., Mobile Responsive before dark mode for better compatibility).
