# Admin Form Style Unification Design

## Problem

Admin page tabs (downloads, categories, announcements, chat) have inconsistent form styling:
- `AnnouncementForm`: 1px borders, neutral label colors, different button gradient
- `ChatManager`: different input focus color, non-standard save button gradient
- `AdminLogin`: larger button radius (20px) and padding, diverges from panel forms

## Goal

Unify all admin form UI elements (inputs, labels, buttons, selects, textareas) using `DownloadForm` as the canonical reference.

## Approach: Global CSS Variables + Shared Classes

Create `src/lib/styles/admin-form.css` with design tokens and utility classes. Import into components to replace duplicated style declarations.

### Design Tokens

```css
--admin-input-border: 2px solid #e6e0f0
--admin-input-radius: 12px
--admin-input-padding: 0.75rem 1rem
--admin-input-focus-border: #6b4c9a
--admin-input-focus-shadow: 0 0 0 3px rgba(107, 76, 154, 0.15)
--admin-label-color: #6b4c9a
--admin-btn-radius: 12px
--admin-btn-gradient: linear-gradient(135deg, #667eea, #764ba2)
```

### Shared Classes

| Class | Purpose |
|---|---|
| `.admin-input` | All text inputs, selects, textareas |
| `.admin-label` | Form labels |
| `.admin-btn` | Base button (radius, transition, font) |
| `.admin-btn-primary` | Gradient primary action button |
| `.admin-btn-ghost` | Outline/secondary button |
| `.admin-btn-danger` | Destructive action button |

## Per-Component Changes

| Component | Changes |
|---|---|
| `AnnouncementForm` | Border 1px → 2px, label color #555 → #6b4c9a, button gradient unified |
| `ChatManager` | Input focus color aligned, save button gradient aligned, danger button unified |
| `AdminLogin` | Button border-radius 20px → 12px, padding aligned; hover animation retained |
| `DownloadForm`, `DownloadEditModal`, `CategoryManager` | Replace duplicated style blocks with shared classes; no visual change |

## Constraints

- Scoped `<style>` blocks remain in each component for layout/specific overrides
- No visual change to `DownloadForm`, `DownloadEditModal`, `CategoryManager` (already correct)
- AdminLogin retains its enhanced hover animation (`translateY(-3px) scale(1.02)`)
