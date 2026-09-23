# Workspace inspection

- The repository is empty aside from `.git`; branch `main`, no commits, no remotes, no tracked files.
- Source page responds `200` and is a static Hotmart Pages document (`Cintura 3D`), about 63 KB of HTML.
- Page structure: 12 sections (hero/VSL, testimonials, problem/solution, included modules, timeline, bonuses, offer, guarantee, recap, CTA, author).
- Fonts: `Playfair Display` and `Plus Jakarta Sans` via Google Fonts.
- Main CTA currently points to `https://pay.hotmart.com/C66545185I?off=fhi4k97c&bid=1773783201822` (three links).
- Image assets found in HTML: Rosangela PNG, Tania Maria PNG, Sonia PNG, Ivone Faustino JPG, and `dra-claudia.jpeg`.
- VSL is embedded with Vturb smart player id `ab-6a985b49bb88584246143bc5`, script URL under `scripts.converteai.net/.../player.js`; no ordinary `<video>` source appears in HTML.

Likely implementation: a static Vite/React or plain HTML/CSS site, preserving the supplied section order, typography, responsive breakpoints, and external image/video URLs or locally mirrored assets.


## Vturb details

- The player script contains two weighted AB variants. Primary video id `6a974ebdbdb298a92b5b9141`; alternate `6aa35988dbc08505aec55ddd`.
- Posters: `https://cdn.converteai.net/c9f32ae4-8f39-4c9a-bd30-543b25800652/6a974ebdbdb298a92b5b9141/poster.jpg` and `https://cdn.converteai.net/c9f32ae4-8f39-4c9a-bd30-543b25800652/6aa35988dbc08505aec55ddd/poster.jpg`.
- The page hides `#reveal` until VSL time around 2911 seconds; preserving the smart player embed is preferable to attempting to mirror a protected stream.
