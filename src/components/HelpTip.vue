<script setup>
import { CircleHelp } from 'lucide-vue-next';

// Native <details> works with touch, mouse and keyboard; no tooltip hover
// dependency or additional popover state is required on iPhone/Android.
defineProps({ label: { type: String, default: 'More information' }, message: { type: String, required: true } });
</script>

<template>
  <details class="help-tip" @click.stop>
    <summary :aria-label="label" :title="label"><CircleHelp :size="16" /></summary>
    <div class="help-tip-content" role="note">{{ message }}</div>
  </details>
</template>
