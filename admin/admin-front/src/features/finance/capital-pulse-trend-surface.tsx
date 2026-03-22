import { Box, Grid, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { MetricLabelWithHint, SurfaceCard } from "@/components/console-ui";
import { formatUsdc } from "@/lib/admin-console";

import type { CapitalPulseTrendLane } from "./finance-presenters";

type CapitalPulseTrendSurfaceProps = {
  eyebrow: string;
  title: string;
  description: string;
  lanes: CapitalPulseTrendLane[];
  stamp?: string | null;
};

function formatTrendValue(value: number, valueType: CapitalPulseTrendLane["valueType"]): string {
  if (valueType === "count") {
    return String(Math.round(value));
  }
  return `${formatUsdc(value)} USDC`;
}

export function CapitalPulseTrendSurface({ eyebrow, title, description, lanes, stamp }: Readonly<CapitalPulseTrendSurfaceProps>) {
  return (
    <SurfaceCard eyebrow={eyebrow} title={title} description={description} stamp={stamp ?? undefined}>
      <Grid templateColumns={{ base: "1fr", xl: "repeat(3, 1fr)" }} gap="16px">
        {lanes.map((lane) => (
          <Box key={lane.key} borderRadius="24px" p={{ base: "16px", md: "18px" }} bg="rgba(248,250,252,0.92)" border="1px solid rgba(15,17,21,0.06)">
            <Stack gap="4px">
              <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">{lane.title}</Text>
              <Text color="ink.500">{lane.description}</Text>
            </Stack>

            <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap="10px" mt="14px">
              <Box borderRadius="18px" p="14px" bg="rgba(255,255,255,0.9)" border="1px solid rgba(15,17,21,0.05)">
                <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{lane.latestLabel}</Text>
                <Heading mt="8px" size="sm">{lane.latestValue}</Heading>
              </Box>
              <Box borderRadius="18px" p="14px" bg="rgba(255,255,255,0.9)" border="1px solid rgba(15,17,21,0.05)">
                <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{lane.aggregateLabel}</Text>
                <Heading mt="8px" size="sm">{lane.aggregateValue}</Heading>
              </Box>
            </Grid>

            <Box mt="14px" h="180px" borderRadius="20px" bg="rgba(255,255,255,0.82)" border="1px solid rgba(15,17,21,0.05)" p="10px 6px 0 0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lane.data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(99,92,82,0.10)" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#635c52", fontSize: 11 }} />
                  <YAxis hide width={0} />
                  <Tooltip
                    formatter={(value) => formatTrendValue(Number(value ?? 0), lane.valueType)}
                    contentStyle={{
                      borderRadius: "18px",
                      border: "1px solid rgba(99,92,82,0.12)",
                      background: "rgba(255,255,255,0.96)",
                      boxShadow: "0 16px 42px rgba(23, 19, 17, 0.10)",
                    }}
                  />
                  {lane.series.map((series) => (
                    <Line
                      key={series.key}
                      type="monotone"
                      dataKey={series.key}
                      stroke={series.color}
                      strokeWidth={series.key === "primary" ? 3 : 2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Box>

            <HStack gap="10px" wrap="wrap" mt="12px">
              {lane.series.map((series) => (
                <HStack key={series.key} gap="6px">
                  <Box w="10px" h="10px" borderRadius="full" bg={series.color} />
                  <Text fontSize="12px" color="ink.500">{series.label}</Text>
                </HStack>
              ))}
            </HStack>

            <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap="10px" mt="12px">
              {lane.supportMetrics.map((metric) => (
                <Box key={metric.key} borderRadius="18px" p="14px" bg="rgba(255,255,255,0.88)" border="1px solid rgba(15,17,21,0.05)">
                  <Box fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">
                    <MetricLabelWithHint label={metric.label} hint={metric.hint} />
                  </Box>
                  <Heading mt="8px" size="sm">{metric.value}</Heading>
                </Box>
              ))}
            </Grid>
          </Box>
        ))}
      </Grid>
    </SurfaceCard>
  );
}