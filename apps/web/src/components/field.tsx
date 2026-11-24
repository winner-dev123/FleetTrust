"use client";

import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";

interface FieldText {
  label: ReactNode;
  /** Shown under the label and announced with the control. */
  hint?: ReactNode;
  /** Validation message: marks the control invalid and is announced with it. */
  error?: string | null;
}

/** Ids that tie the label, hint and error to the control (WCAG 1.3.1, 3.3.1, 3.3.2). */
function useFieldIds(id: string | undefined, hint: unknown, error: unknown) {
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return { controlId, hintId, errorId, describedBy };
}

function Frame({
  controlId,
  label,
  hint,
  hintId,
  error,
  errorId,
  required,
  children,
}: FieldText & {
  controlId: string;
  hintId: string | undefined;
  errorId: string | undefined;
  required: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={controlId}>
        {label}
        {required ? null : <span className="muted small"> (optional)</span>}
      </label>
      {hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  id,
  ...rest
}: FieldText & InputHTMLAttributes<HTMLInputElement>) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Frame {...ids} label={label} hint={hint} error={error} required={rest.required}>
      <input
        {...rest}
        id={ids.controlId}
        className="input"
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
      />
    </Frame>
  );
}

export function TextArea({
  label,
  hint,
  error,
  id,
  ...rest
}: FieldText & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Frame {...ids} label={label} hint={hint} error={error} required={rest.required}>
      <textarea
        {...rest}
        id={ids.controlId}
        className="input"
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
      />
    </Frame>
  );
}

export function SelectField({
  label,
  hint,
  error,
  id,
  options,
  ...rest
}: FieldText &
  SelectHTMLAttributes<HTMLSelectElement> & {
    options: readonly { value: string; label: string }[];
  }) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Frame {...ids} label={label} hint={hint} error={error} required={rest.required}>
      <select
        {...rest}
        id={ids.controlId}
        className="input"
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Frame>
  );
}

export function Checkbox({
  label,
  hint,
  id,
  ...rest
}: { label: ReactNode; hint?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const ids = useFieldIds(id, hint, undefined);
  return (
    <div className="checkbox">
      <input {...rest} type="checkbox" id={ids.controlId} aria-describedby={ids.describedBy} />
      <span>
        <label htmlFor={ids.controlId}>{label}</label>
        {hint ? (
          <span className="field__hint" id={ids.hintId} style={{ display: "block" }}>
            {hint}
          </span>
        ) : null}
      </span>
    </div>
  );
}
