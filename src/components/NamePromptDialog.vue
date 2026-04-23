<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useGettext } from 'vue3-gettext'

const props = defineProps<{ initialName?: string }>()
const emit = defineEmits<{ confirm: [name: string] }>()
const { $gettext } = useGettext()
const nameInput = ref(props.initialName || '')
const inputRef = ref<HTMLInputElement | null>(null)
const isValid = computed(() => nameInput.value.trim().length > 0)

function confirm() {
  if (!isValid.value) return
  emit('confirm', nameInput.value.trim())
}

onMounted(() => {
  inputRef.value?.focus()
})
</script>

<template>
  <div class="name-prompt-overlay" @keyup.escape="inputRef?.focus()">
    <div
      class="name-prompt-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-prompt-title"
    >
      <h3 id="name-prompt-title">{{ $gettext('Join Collaboration') }}</h3>
      <p>{{ $gettext('Enter your display name so others can identify you.') }}</p>
      <label for="name-prompt-input" class="visually-hidden">{{ $gettext('Your name') }}</label>
      <input
        id="name-prompt-input"
        ref="inputRef"
        v-model="nameInput"
        type="text"
        :placeholder="$gettext('Your name')"
        class="name-prompt-input"
        maxlength="50"
        required
        @keyup.enter="confirm"
      />
      <button class="name-prompt-button" :disabled="!isValid" @click="confirm">
        {{ $gettext('Join') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.name-prompt-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--oc-role-scrim, rgba(0, 0, 0, 0.5));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.name-prompt-dialog {
  background: var(--oc-role-surface, #fff);
  border-radius: 12px;
  padding: 2rem;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  text-align: center;
}

.name-prompt-dialog h3 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
  font-family: var(--oc-font-family, sans-serif);
  color: var(--oc-role-on-surface, #191c1d);
}

.name-prompt-dialog p {
  margin: 0 0 1.25rem;
  font-family: var(--oc-font-family, sans-serif);
  color: var(--oc-role-on-surface-variant, #40484c);
  font-size: 0.9rem;
}

.name-prompt-input {
  width: 100%;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 8px;
  font-size: 1rem;
  font-family: var(--oc-font-family, sans-serif);
  margin-bottom: 1rem;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s;
  background: var(--oc-role-surface-container-low, #fbfcfe);
  color: var(--oc-role-on-surface, #191c1d);
}

.name-prompt-input::placeholder {
  color: var(--oc-role-outline, #70787c);
}

.name-prompt-input:focus {
  border-color: var(--oc-role-primary, #00677f);
}

.name-prompt-button {
  width: 100%;
  padding: 0.6rem;
  background: var(--oc-role-primary, #00677f);
  color: var(--oc-role-on-primary, #ffffff);
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-family: var(--oc-font-family, sans-serif);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.name-prompt-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.name-prompt-button:hover:not(:disabled) {
  background: var(--oc-role-secondary, #20434f);
  color: var(--oc-role-on-secondary, #ffffff);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
