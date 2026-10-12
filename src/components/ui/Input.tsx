import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onFocus" | "onBlur" | "size"> {
  label?: string;
  size?: "xs" | "sm" | "default" | "lg";
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  invalid?: boolean;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, type, onFocus, onBlur, label, id, disabled, size = "default", leading, trailing, invalid = false, ...props },
    ref,
  ) => {
    const [focused, setFocused] = React.useState(false);
    const generatedId = React.useMemo(() => (id != null ? id : label), [id, label]);
    const inputWrap = (
      <div
        className={cn(
          "border-[var(--slate-6)] bg-[var(--slate-1)] font-sans flex w-full items-center rounded-sm border",
          "ring-offset-[var(--slate-1)]",
          {
            "h-5": size === "xs",
            "h-6": size === "sm",
            "h-8": size === "default",
            "h-10": size === "lg",
            "ring-primary outline-none ring-2 ring-offset-2": focused,
            "disabled:opacity-50": disabled,
            "border-[var(--red-9)]": invalid,
          },
          className,
        )}
      >
        {leading ? (
          <div className={cn("font-sans text-xs text-[var(--slate-11)] ml-2 select-none font-normal", {
            "text-sm": size == "default",
            "text-md": size == "lg",
          })}>
            {leading}
          </div>
        ) : null}
        <input
          type={type}
          id={generatedId}
          disabled={disabled}
          ref={ref}
          className={cn(
            "placeholder:text-[var(--slate-10)] w-full border-0 bg-transparent outline-none focus:ring-0",
            "font-sans text-base file:text-[var(--slate-12)] font-normal file:border-0 file:bg-transparent",
            "text-[var(--slate-12)] text-xs disabled:cursor-not-allowed disabled:opacity-50",
            "[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            {
              "pl-2": leading,
              "pr-2": trailing,
              "px-1": size == "xs",
              "px-2": size == "sm",
              "text-sm px-3": size == "default",
              "text-md px-3": size == "lg",
            },
          )}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
        {trailing ? (
          <div className={cn("font-sans text-xs text-[var(--slate-11)] mr-3 select-none font-normal", {
            "text-sm": size == "default",
            "text-md": size == "lg",
          })}>
            {trailing}
          </div>
        ) : null}
      </div>
    );

    return label ? (
      <div className="flex flex-col gap-1.5">
        <label className="font-sans text-xs text-[var(--slate-11)] font-normal" htmlFor={generatedId}>
          {label}
        </label>
        {inputWrap}
      </div>
    ) : (
      inputWrap
    );
  },
);
Input.displayName = "Input";

export { Input };
