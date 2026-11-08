# Bundled development artwork

Original artwork created for this repository's Phase 8.2 development fixtures.
The SVG sources and WebP exports in this directory are dedicated to the public
domain under CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/.
No third-party photographs, brand marks, stock assets or embedded fonts are included.
Dune 81 Studio and Form 81 Studio are fictional development labels.

These are garment illustrations, not product photography. Each detail image is a
crop of the corresponding full illustration, not a claim of another camera angle.
Size variants share their product's design; no color variants are invented.

Each tenant directory contains:

- `tee-front`, `tee-detail`, `denim-front`, `denim-detail`, `shoes-front`,
  `shoes-detail`: 800 × 800 WebP and editable SVG source.
- `identity`: 512 × 512 logo/brand tile.
- `everyday-edit`: 1200 × 600 desktop banner.
- `everyday-edit-mobile`: 800 × 800 mobile banner.

WebP exports use quality 85; every file is under 100 KB. The entire bundle is less
than 400 KB. Exports were made once with Sharp/libvips already available in the
workspace. There is no new dependency or runtime generator. Edit SVG sources with
any SVG editor and export to the same dimensions when intentionally updating art.
Keep matching source/export pairs together.

The existing `/uploads/development-v82/` URL prefix serves this immutable directory
through a narrowly scoped static mount, independently of writable UPLOAD_DIR.
Only WebP paths under fashion/independent are public; SVG sources and this README
are not served. The source and compiled backend resolve the bundle relative to
their module location, so restarting or changing the working directory does not
change the media root. Docker's runtime stage copies this directory separately
from writable uploads; the build context allows only its WebPs.

Database image fields contain root-relative `/uploads/development-v82/...` paths.
Resolve them with the client's configured backend origin, not its `/api/v1` prefix.
No host address is stored in fixture media records. Existing merchant-customized
media is preserved. The seed never copies, writes or deletes assets. Storage delete
preserves the reserved `development-v82/` namespace for legacy fixture references.
Ordinary merchant uploads retain their existing deletion behavior.

This public demonstration media is not access-controlled. Tenant isolation applies
to API records and relationships, not confidentiality of public image bytes.
See `docs/phase8.2-visual-seed-data.md` for setup and Flutter usage.
