<script lang="ts">
  // Phosphor-style open issue, which Phosphor lacks: a ring around a dot.
  let { size = 16 }: { size?: number | string } = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" role="img" width={size} height={size} viewBox="0 0 256 256" fill="currentColor">
  <circle cx="128" cy="128" r="96" fill="none" stroke="currentColor" stroke-width="16" />
  <circle cx="128" cy="128" r="28" />
</svg>
