import './SaveButton.css'

interface SaveButtonProps {
  isDirty: boolean
  onSave: () => void
}

export default function SaveButton({ isDirty, onSave }: SaveButtonProps) {
  return (
    <button
      className={`excalidraw-save-button ${isDirty ? 'excalidraw-save-button--active' : 'excalidraw-save-button--disabled'}`}
      onClick={onSave}
      disabled={!isDirty}
      title={isDirty ? 'Save (Ctrl+S)' : 'No unsaved changes'}
      aria-label="Save"
    >
      <svg
        fill="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M7 19V13H17V19H19V7.82843L16.1716 5H5V19H7ZM4 3H17L21 7V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3ZM9 15V19H15V15H9Z" />
      </svg>
    </button>
  )
}
