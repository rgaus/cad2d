"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BaseAction } from "@/lib/actions/BaseAction";
import { Input } from "@/components/ui/input";
import { KeyboardShortcut } from "./KeyboardShortcut";
import fuzzy from "fuzzy";

type ActionMenuProps = {
  actions: Array<BaseAction>;
  onSelect: () => void;
};

export function ActionMenu({ actions, onSelect }: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
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
          className="absolute left-0 my-1 z-50 bg-[var(--slate-3)] border border-[var(--slate-5)] rounded-[4px] overflow-hidden"
          style={{
            top: "100%",
            width: 280,
          }}
        >
          <div className="p-2 border-b border-[var(--slate-5)]">
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
            className="max-h-64 overflow-y-auto"
            style={{ maxHeight: 256 }}
          >
            {filteredActions.length === 0 ? (
              <div
                className="p-3 text-center text-sm"
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
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--slate-4)] transition-colors text-left"
                  style={{ minHeight: 44 }}
                >
                  <span style={{ color: "var(--slate-11)" }}>{action.icon}</span>
                  <span className="flex-1" style={{ color: "var(--slate-12)" }}>
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
}

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