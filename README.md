# ChefDuo website

Static HTML, CSS, and JavaScript website for ChefDuo.

## Project structure

- `home.html`: homepage and store information.
- `about.html`, `menu.html`, `menu2.html`, `reviews.html`: website pages.
- `Style.css` and `Script.js`: shared styles and interactions.
- `footer.html`: shared footer loaded by JavaScript.
- `src/`: website images.

## Deployment on Vercel

Deploy the repository root as a static website. There is no build step or generated output directory.

Keep `vercel.json` in the repository root: its rewrite maps `/` to `/home.html`.

Asset references must match the exact filename casing, including `Style.css`, `Script.js`, and `src/menu1.jpg`, because deployment paths are case-sensitive.

## Preview and verification

Use a local HTTP server to preview the website so the shared footer can load through `fetch`.

Before publishing, check the homepage, navigation, menu filters, image lightbox, and footer. After deployment, verify that `/` opens the homepage and that styles, scripts, and images load correctly.