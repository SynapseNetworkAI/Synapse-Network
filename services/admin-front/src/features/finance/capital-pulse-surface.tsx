import { Box, Button, Grid, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";

import { MetricLabelWithHint, SurfaceCard } from "@/components/console-ui";

import type { CapitalPulseLane } from "./finance-presenters";

type CapitalPulseSurfaceProps = {
  eyebrow: string;
  title: string;
  description: string;
  lanes: CapitalPulseLane[];
  stamp?: string | null;
  compact?: boolean;
  ctaHref?: string;
  ctaLabel?: string;
};

const laneBackgrounds: Record<CapitalPulseLane["key"], string> = {
  consumer: "linear-gradient(180deg, rgba(31,146,87,0.06) 0%, rgba(247,249,252,0.96) 100%)",
  platform: "linear-gradient(180deg, rgba(15,17,21,0.04) 0%, rgba(247,249,252,0.96) 100%)",
  provider: "linear-gradient(180deg, rgba(243,106,29,0.06) 0%, rgba(247,249,252,0.96) 100%)",
};

export function CapitalPulseSurface({
  eyebrow,
  title,
  description,
  lanes,
  stamp,
  compact = false,
  ctaHref,
  ctaLabel,
}: Readonly<CapitalPulseSurfaceProps>) {
  return (
    <SurfaceCard
      eyebrow={eyebrow}
      title={title}
      description={description}
      stamp={stamp ?? undefined}
      actions={ctaHref && ctaLabel ? (
        <Link href={ctaHref}>
          <Button borderRadius="full" bg="#0f1115" color="#f4f7fb" _hover={{ bg: "#1b1f26" }}>
            {ctaLabel}
          </Button>
        </Link>
      ) : undefined}
    >
      <Grid templateColumns={{ base: "1fr", xl: "repeat(3, 1fr)" }} gap="14px">
        {lanes.map((lane) => (
          <Box
            key={lane.key}
            borderRadius="24px"
            p={{ base: "16px", md: "18px" }}
            bg={laneBackgrounds[lane.key]}
            border="1px solid rgba(15,17,21,0.06)"
          >
            <Stack gap="4px">
              <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">
                {lane.title}
              </Text>
              {compact ? null : <Text color="ink.500">{lane.description}</Text>}
            </Stack>

            <Grid templateColumns={compact ? "1fr" : { base: "1fr", md: "repeat(2, 1fr)" }} gap="10px" mt="14px">
              {lane.items.map((item) => (
                <Box key={item.key} borderRadius="18px" p="14px" bg="rgba(255,255,255,0.82)" border="1px solid rgba(15,17,21,0.05)">
                  <HStack justify="space-between" align="flex-start" gap="10px">
                    <Box fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">
                      <MetricLabelWithHint label={item.label} hint={item.hint} />
                    </Box>
                    {compact ? null : <Box w="8px" h="8px" borderRadius="full" bg="rgba(15,17,21,0.12)" mt="5px" />}
                  </HStack>
                  <Heading mt="10px" size="sm">{item.value}</Heading>
                </Box>
              ))}
            </Grid>
          </Box>
        ))}
      </Grid>
    </SurfaceCard>
  );
}