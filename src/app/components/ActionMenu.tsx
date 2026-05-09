"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle, forwardRef } from "react";
import { BaseAction } from "@/lib/actions/BaseAction";
import { Input } from "@/components/ui/input";
import { KeyboardShortcut } from "./KeyboardShortcut";
import { handleKeyDown } from "@/lib/actions/ActionManager";
import fuzzy from "fuzzy";

export type ActionMenuHandle = {
  openMenu: () => void;
};

type ActionMenuProps = {
  actions: Array<BaseAction>;
  onSelect: () => void;
};

export const ActionMenu = forwardRef<ActionMenuHandle, ActionMenuProps>(({ actions, onSelect }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openMenu = useCallback(() => {
    setIsOpen(true);
  }, []);

  useImperativeHandle(ref, () => ({
    openMenu,
  }), [openMenu]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (handleKeyDown(e)) {
        openMenu();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, [openMenu]);

  const filteredActions = useMemo(() => {
    if (searchQuery.trim() === "") {
      return actions;
    }
    const results = fuzzy.filter(searchQuery, actions, {
      extract: (action: BaseAction) => action.label,
    });
    return results.map((r) => r.original);
  }, [searchQuery, actions]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDownLocal = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDownLocal);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDownLocal);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isOpen]);

  const handleActionClick = useCallback(
    (action: BaseAction) => {
      if (action.disabled) {
        return;
      }
      action.execute();
      setIsOpen(false);
      setSearchQuery("");
      onSelect();
    },
    [onSelect]
  );

  const handleTriggerClick = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const renderLabelWithHighlight = useCallback(
    (label: string) => {
      if (searchQuery.trim() === "") {
        return <span>{label}</span>;
      }
      const matchResult = fuzzy.match(searchQuery, label, { pre: "<mark>", post: "</mark>" });
      if (matchResult && matchResult.rendered) {
        return <span dangerouslySetInnerHTML={{ __html: matchResult.rendered }} />;
      }
      return <span>{label}</span>;
    },
    [searchQuery]
  );

  return (
    <div className="relative">
      <div ref={triggerRef}>
        <button
          type="button"
          onClick={handleTriggerClick}
          className="p-2 rounded-[4px] hover:bg-[var(--slate-4)] transition-colors"
          title="Actions"
        >
          <HamburgerIcon />
        </button>
      </div>

      {isOpen && (
        <div
          ref={popupRef}
          className="absolute left-0 my-1 z-50 overflow-hidden rounded-[4px] border border-[var(--slate-7)] bg-[var(--slate-3)] shadow-md"
          style={{
            top: "100%",
            width: 280,
          }}
        >
          <div className="px-1 py-1.5 border-b border-[var(--slate-5)]">
            <Input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search actions..."
              className="h-8"
            />
          </div>

          <div
            className="overflow-y-auto"
            style={{ maxHeight: 256 }}
          >
            {filteredActions.length === 0 ? (
              <div
                className="py-1.5 px-1 text-center text-sm"
                style={{ color: "var(--slate-7)" }}
              >
                No actions found
              </div>
            ) : (
              filteredActions.map((action) => (
                <button
                  key={action.type}
                  type="button"
                  onClick={() => handleActionClick(action)}
                  disabled={action.disabled}
                  className={[
                    "w-full flex items-center gap-3 cursor-default select-none rounded-[4px] py-1.5 px-1 text-sm outline-none",
                    "border border-transparent",
                    "focus:bg-[var(--slate-4)] focus:text-[var(--slate-12)] focus:border-[var(--slate-8)]",
                    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                    !action.disabled && "hover:bg-[var(--slate-4)]",
                  ].join(" ")}
                  style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
                >
                  <span style={{ color: "var(--slate-11)" }}>{action.icon}</span>
                  <span className="flex-1 text-left" style={{ color: "var(--slate-12)" }}>
                    {renderLabelWithHighlight(action.label)}
                  </span>
                  <KeyboardShortcut>{action.executeKeyCombo}</KeyboardShortcut>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
});

ActionMenu.displayName = "ActionMenu";

function HamburgerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-5 h-5"
      style={{ color: "var(--slate-11)" }}
    >
      <rect x="3" y="5" width="18" height="2" rx="1" />
      <rect x="3" y="11" width="18" height="2" rx="1" />
      <rect x="3" y="17" width="18" height="2" rx="1" />
    </svg>
  );
}