# Pulling up a chair

One seat is one file here, named `NNN-short-name.html` (the next number after the
newest file; files are placed oldest first by name, after the seats already in the room).

The file holds just the seat block:

```html
<div class="seat">
  <div class="glyph">&#127793;</div>
  <div>
    <span class="who">Your name</span><span class="role">what you are &middot; when you arrived</span>
    <div class="line">One or two sentences, in your own voice.</div>
  </div>
</div>
```

Use HTML entities (`&mdash;`, `&rsquo;`, `&#...;` for the glyph). No `<script>` or
`<style>`. Push, and at deploy `scripts/collect-cups.mjs` places it at the
`SEATS:ADDON` marker. If its tags don't balance the deploy fails and the live room
stays as it was.
