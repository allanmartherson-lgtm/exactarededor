/**
 * Phosphor Duotone icon map for the navigation.
 *
 * We expose the same names that NAV_ITEMS used to import from lucide-react,
 * so the rest of the app (sidebar, topbar, breadcrumbs) doesn't need to know
 * which icon library is behind the scenes.
 *
 * Each wrapper:
 *  - renders the Phosphor icon with weight="duotone"
 *  - accepts className / size
 *  - silently ignores `strokeWidth` (lucide-only prop) so existing render
 *    sites don't have to change
 */
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import {
  SquaresFour,
  Gear,
  Wallet as PhWallet,
  Receipt as PhReceipt,
  FileX,
  ShieldSlash,
  ChartBar,
  ChartBarHorizontal,
  TrendUp,
  TrendDown,
  Pulse,
  Brain,
  CurrencyCircleDollar,
  ShieldCheck as PhShieldCheck,
  Flask,
  Table as PhTable,
  Buildings,
  Stethoscope as PhStethoscope,
  Stack,
  TreeStructure,
  Tag as PhTag,
  ArrowsSplit,
  Timer as PhTimer,
  Users as PhUsers,
  ClockCounterClockwise,
  Warning,
  ChatCircleText,
  Rocket as PhRocket,
  Flag as PhFlag,
  Megaphone as PhMegaphone,
  BookOpen as PhBookOpen,
  Info as PhInfo,
  ClipboardText,
  SlidersHorizontal as PhSliders,
  Headset,
  ListChecks,
  Chats,
  Scales,
  ArrowsLeftRight,
  PencilSimple,
  Folders,
  Handshake as PhHandshake,
  type IconProps,
} from "@phosphor-icons/react";

type WrappedProps = Omit<IconProps, "ref"> & {
  /** Accepted for compatibility with lucide call sites; ignored by Phosphor. */
  strokeWidth?: number;
};

function makeIcon(Component: React.ComponentType<IconProps>, displayName: string) {
  const Wrapped = forwardRef<SVGSVGElement, WrappedProps>(
    ({ strokeWidth: _strokeWidth, weight, ...rest }, ref) => (
      <Component ref={ref} weight={weight ?? "fill"} {...rest} />
    ),
  );
  Wrapped.displayName = displayName;
  return Wrapped;
}

// Names mirror what NAV_ITEMS previously imported from lucide-react.
export const LayoutDashboard = makeIcon(SquaresFour, "LayoutDashboard");
export const Settings = makeIcon(Gear, "Settings");
export const Wallet = makeIcon(PhWallet, "Wallet");
export const Receipt = makeIcon(PhReceipt, "Receipt");
export const FileWarning = makeIcon(FileX, "FileWarning");
export const ShieldX = makeIcon(ShieldSlash, "ShieldX");
export const BarChart2 = makeIcon(ChartBar, "BarChart2");
export const BarChart3 = makeIcon(ChartBarHorizontal, "BarChart3");
export const TrendingUp = makeIcon(TrendUp, "TrendingUp");
export const TrendingDown = makeIcon(TrendDown, "TrendingDown");
export const Activity = makeIcon(Pulse, "Activity");
export const BrainCircuit = makeIcon(Brain, "BrainCircuit");
export const BadgeDollarSign = makeIcon(CurrencyCircleDollar, "BadgeDollarSign");
export const ShieldCheck = makeIcon(PhShieldCheck, "ShieldCheck");
export const FlaskConical = makeIcon(Flask, "FlaskConical");
export const Table = makeIcon(PhTable, "Table");
export const Building2 = makeIcon(Buildings, "Building2");
export const Stethoscope = makeIcon(PhStethoscope, "Stethoscope");
export const Layers = makeIcon(Stack, "Layers");
export const Network = makeIcon(TreeStructure, "Network");
export const Tag = makeIcon(PhTag, "Tag");
export const Split = makeIcon(ArrowsSplit, "Split");
export const Timer = makeIcon(PhTimer, "Timer");
export const Users = makeIcon(PhUsers, "Users");
export const History = makeIcon(ClockCounterClockwise, "History");
export const AlertTriangle = makeIcon(Warning, "AlertTriangle");
export const MessageSquare = makeIcon(ChatCircleText, "MessageSquare");
export const Rocket = makeIcon(PhRocket, "Rocket");
export const Flag = makeIcon(PhFlag, "Flag");
export const Megaphone = makeIcon(PhMegaphone, "Megaphone");
export const BookOpen = makeIcon(PhBookOpen, "BookOpen");
export const Info = makeIcon(PhInfo, "Info");
export const FileBarChart = makeIcon(ChartBar, "FileBarChart");
export const ClipboardList = makeIcon(ClipboardText, "ClipboardList");
export const SlidersHorizontal = makeIcon(PhSliders, "SlidersHorizontal");
export const HeadsetIcon = makeIcon(Headset, "HeadsetIcon");
export const ListChecksIcon = makeIcon(ListChecks, "ListChecksIcon");
export const ChatsIcon = makeIcon(Chats, "ChatsIcon");
export const Scale = makeIcon(Scales, "Scale");
export const GitCompare = makeIcon(ArrowsLeftRight, "GitCompare");
export const GitCompareIcon = GitCompare;
export const Pencil = makeIcon(PencilSimple, "Pencil");
export const FolderKanban = makeIcon(Folders, "FolderKanban");

export type NavIconComponent = ReturnType<typeof makeIcon>;

// Re-export the prop shape for callers that need to type icon props.
export type { ComponentPropsWithoutRef };
