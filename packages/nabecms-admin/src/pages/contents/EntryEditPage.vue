<script setup lang="ts">
import EntryReferenceWorkspace from "./entry-edit/EntryReferenceWorkspace.vue";
import { referenceKey } from "./entry-edit/referenceSession";
defineProps<{ modelId: string; entryId: string }>();
</script>

<template>
  <EntryReferenceWorkspace :key="referenceKey({ modelId, entryId })" :model-id="modelId" :entry-id="entryId" />
</template>
