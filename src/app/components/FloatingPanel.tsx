"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type FloatingPanelProps = {
  title?: string;
  children: React.ReactNode;
  className?: string;
};

export default function FloatingPanel({ title, children, className = "" }: FloatingPanelProps) {
  return (
    <Card
      className={className}

      // Keep these events from propagating and effecting the viewport state at all
      onWheel={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      {typeof title !== 'undefined' ? (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent>
        {children}
      </CardContent>
    </Card>
  );
}
