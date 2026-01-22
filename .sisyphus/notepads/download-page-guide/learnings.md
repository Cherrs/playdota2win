# Learnings

- Svelte 5 `$state` and `onclick` usage is clean and effective for modal state management.
- Simple regex-based markdown parsing is sufficient for basic requirements but should be used with caution regarding XSS (handled here by escaping HTML first).
- CSS modules in Svelte (`<style>`) work well for scoping component styles, but `:global` is needed for dynamic HTML content like the markdown renderer.
