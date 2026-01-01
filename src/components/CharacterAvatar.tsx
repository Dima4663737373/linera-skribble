import { BigHead, theme } from "@bigheads/core";
import type { AvatarProps } from "@bigheads/core";
import { cn } from "./ui/utils";
import React from "react";

export function CharacterAvatar({
  props,
  className,
}: {
  props: AvatarProps;
  className?: string;
}) {
  theme.colors.bgColors.blue = "#ef4444";

  const normalizedProps: AvatarProps = {
    ...props,
    circleColor: "blue",
  };

  const element = <BigHead {...normalizedProps} />;
  const sizedElement = React.isValidElement(element)
    ? React.cloneElement(element as React.ReactElement<any>, {
        width: "100%",
        height: "100%",
        style: { ...(element.props as any)?.style, display: "block" },
      })
    : element;

  return (
    <div className={cn("overflow-hidden", className)}>
      {sizedElement}
    </div>
  );
}
