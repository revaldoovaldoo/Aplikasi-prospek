import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

interface EditableProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  singleLine?: boolean;
  label?: string;
}

/**
 * Teks yang bisa diklik dan diedit langsung di atas draft.
 * Nilai disimpan saat fokus berpindah, sehingga caret tidak terganggu.
 */
export default function Editable({
  value,
  onChange,
  className = "",
  placeholder,
  singleLine = false,
  label,
}: EditableProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.innerText !== value) {
      el.innerText = value;
    }
  }, [value]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const text = el.innerText.replace(/\u00a0/g, " ").replace(/\n+$/, "");
    if (text !== value) onChange(text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      return;
    }
    if (singleLine && event.key === "Enter") {
      event.preventDefault();
      ref.current?.blur();
    }
    if (event.key === "Escape" && ref.current) {
      ref.current.innerText = value;
      ref.current.blur();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/\r/g, "");
    document.execCommand("insertText", false, singleLine ? text.replace(/\n/g, " ") : text);
  };

  return (
    <div
      ref={ref}
      className={`editable${singleLine ? " editable-single" : ""}${className ? ` ${className}` : ""}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={!singleLine}
      aria-label={label}
      data-placeholder={placeholder}
      spellCheck={false}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    />
  );
}
