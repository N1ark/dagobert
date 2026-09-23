<script lang="ts">
  // Phosphor-style companion to GitPullRequest: the branch, cut short by a cross.
  let { size = 16 }: { size?: number | string } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  width={size}
  height={size}
  viewBox="0 0 256 256"
  fill="none"
  stroke="currentColor"
  stroke-width="16"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="72" cy="64" r="24" />
  <circle cx="72" cy="192" r="24" />
  <line x1="72" y1="88" x2="72" y2="168" />
  <circle cx="200" cy="192" r="24" />
  <line x1="200" y1="112" x2="200" y2="168" />
  <line x1="176" y1="40" x2="224" y2="88" />
  <line x1="224" y1="40" x2="176" y2="88" />
</svg>
