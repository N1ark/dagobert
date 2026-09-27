<script lang="ts">
  // Phosphor-style companion to the Align icons: a box spaced evenly between two edges.
  let { size = 16, vertical = false }: { size?: number | string; vertical?: boolean } = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" role="img" width={size} height={size} viewBox="0 0 256 256" fill="currentColor">
  <path
    transform={vertical ? "rotate(90 128 128)" : undefined}
    d="M48,40V216a8,8,0,0,1-16,0V40a8,8,0,0,1,16,0ZM224,40V216a8,8,0,0,1-16,0V40a8,8,0,0,1,16,0ZM104,48h48a16,16,0,0,1,16,16v128a16,16,0,0,1-16,16H104a16,16,0,0,1-16-16V64A16,16,0,0,1,104,48Zm0,144h48V64H104Z"
  />
</svg>
