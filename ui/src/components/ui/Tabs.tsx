import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/Utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  // `items-stretch` (not `items-center`) — triggers fill the full height of
  // the list so their bottom border lands exactly at the list's baseline.
  // With `items-center` the trigger is vertically centered and its
  // underline ends a few pixels above the list border, hiding behind the
  // gray baseline.
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-stretch justify-start gap-1 overflow-x-auto border-b border-gray-200 bg-white px-2",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  // `-mb-px` pulls the trigger down by 1px so its 3px bottom border
  // overlaps the TabsList's own 1px `border-b`. The trigger has its own
  // `inline-flex items-center` so the label stays vertically centered even
  // though the list itself stretches us to its full height.
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-[3px] border-transparent px-3 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-blue-600 data-[state=active]:font-semibold data-[state=active]:text-blue-700",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("flex-1 overflow-auto focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
