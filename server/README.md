# GE360 Tools home page

`index.html` — landing page at `navybook.com/D1/index.html` listing all GE360 newsroom tools with descriptions and access instructions.

## Deploy

This file lives **outside** the git deploy path (`D1/seo/`), so it cannot be deployed via the normal `deploy` alias. Use scp directly:

```bash
scp server/index.html bradwu@pdx1-shared-a1-08.dreamhost.com:/home/bradwu/navybook.com/D1/index.html
```

## CSS

Inherits `updates/updates.css` (served from `navybook.com/D1/updates/updates.css`) and overrides the header to match the inline flexbox style used by `navybook.com/D1/seo/`.

## To do

- [ ] Unify CSS for all these components

## Placeholder

The Athena Tools Chrome Web Store link (`chromewebstore.google.com/detail/athena-tools/okllcogcjdniedlhjkjmppoknfpemajk`) is already wired up. No placeholders remain.
