import { FiArrowUpRight } from "react-icons/fi";

type ArrowDirection = "up-right" | "left" | "right" | "up";
type ArrowSize = "text" | "button";

export function ArrowIcon({
  direction = "up-right",
  size = "text",
}: {
  direction?: ArrowDirection;
  size?: ArrowSize;
}) {
  return (
    <FiArrowUpRight
      aria-hidden="true"
      focusable="false"
      className={`arrow-icon arrow-icon--${size} arrow-icon--${direction}`}
      strokeWidth={1.5}
    />
  );
}
