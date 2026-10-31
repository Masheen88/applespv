<script setup>
import { computed, ref } from 'vue';
import { Check, Clipboard, ChevronDown, MapPin, Pencil, X } from 'lucide-vue-next';

const props = defineProps({ address: { type: Object, required: true } });
const editing = ref(false);
const expanded = ref(false);
const copied = ref(false);

const headline = computed(() => props.address.street || 'No address entered');
const subline = computed(() => [props.address.city, props.address.region, props.address.postal].filter(Boolean).join(', ') || 'Tap Edit to add a location reference');
const fullText = computed(() => [
  props.address.street,
  [props.address.city, props.address.region, props.address.postal].filter(Boolean).join(', '),
  props.address.reference && `Reference: ${props.address.reference}`,
  props.address.notes && `Notes: ${props.address.notes}`,
].filter(Boolean).join('\n'));

async function copyAddress() {
  if (!fullText.value) return;
  try {
    await navigator.clipboard.writeText(fullText.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1800);
  } catch { /* Copy requires HTTPS and a user gesture on some browsers. */ }
}
</script>

<template>
  <section class="card-surface address-card" aria-label="Address reference">
    <div class="flex items-start gap-2.5">
      <div class="rounded-xl bg-mint/10 p-2 text-mint shrink-0"><MapPin :size="18" /></div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="section-kicker">Address reference</span>
          <span v-if="address.reference" class="rounded-md border border-edge px-2 py-0.5 text-[11px] text-slate-300 truncate max-w-full">{{ address.reference }}</span>
        </div>
        <p class="truncate text-sm font-semibold text-white mt-1">{{ headline }}</p>
        <p class="truncate text-xs text-slate-400 mt-0.5">{{ subline }}</p>
      </div>
      <button class="icon-button" type="button" :disabled="!fullText" title="Copy address details" aria-label="Copy address details" @click="copyAddress">
        <Check v-if="copied" :size="17" class="text-mint" /><Clipboard v-else :size="17" />
      </button>
      <button class="icon-button" type="button" :aria-expanded="editing" aria-label="Edit address" title="Edit address" @click="editing = !editing; expanded = true">
        <X v-if="editing" :size="18" /><Pencil v-else :size="17" />
      </button>
    </div>

    <!-- No map: a single compact, always-visible reference beneath the camera. -->
    <div v-if="!editing && (address.notes || address.reference)" class="mt-2.5">
      <button class="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? 'Hide details' : 'Show details' }} <ChevronDown :size="14" :class="expanded && 'rotate-180'" />
      </button>
      <p v-if="expanded && address.notes" class="mt-2 rounded-lg bg-white/[.035] p-2.5 text-xs text-slate-300 whitespace-pre-wrap break-words">{{ address.notes }}</p>
    </div>

    <form v-if="editing" class="grid grid-cols-2 gap-2.5 mt-3" @submit.prevent="editing = false">
      <label class="field col-span-2">Street / location
        <input v-model="address.street" placeholder="123 Main St" autocomplete="street-address" />
      </label>
      <label class="field col-span-2 sm:col-span-1">City
        <input v-model="address.city" placeholder="City" autocomplete="address-level2" />
      </label>
      <label class="field">State / region
        <input v-model="address.region" placeholder="TN" autocomplete="address-level1" />
      </label>
      <label class="field">ZIP / postal
        <input v-model="address.postal" placeholder="Postal code" autocomplete="postal-code" />
      </label>
      <label class="field">Job / reference ID
        <input v-model="address.reference" placeholder="Optional" />
      </label>
      <label class="field col-span-2">Notes
        <textarea v-model="address.notes" rows="2" placeholder="Access notes, gate code reminder, inspection details…" />
      </label>
      <div class="col-span-2 flex justify-end"><button type="submit" class="button-secondary text-xs !py-2">Done</button></div>
    </form>
  </section>
</template>
