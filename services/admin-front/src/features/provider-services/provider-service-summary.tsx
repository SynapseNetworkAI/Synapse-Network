import { Box, Grid, Heading, Text } from "@chakra-ui/react";

export function ProviderServiceSummary({
  totalCount,
}: Readonly<{ totalCount: number }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap="16px">
      <ProviderServiceSummaryCard
        eyebrow="Registered"
        title={String(totalCount)}
        description="非 deleted 服务总数"
      />
      <ProviderServiceSummaryCard
        eyebrow="Auto drain rule"
        title="healthy target required"
        description="无 healthy target 时自动从 discovery / invoke 摘流"
      />
      <ProviderServiceSummaryCard
        eyebrow="Slow lane"
        title="reduced probe, not stopped"
        description="长期 unhealthy 会降频探活，但不会自动改 inactive"
      />
    </Grid>
  );
}

function ProviderServiceSummaryCard({
  description,
  eyebrow,
  title,
}: Readonly<{
  description: string;
  eyebrow: string;
  title: string;
}>) {
  return (
    <Box
      borderRadius="24px"
      bg="rgba(255,255,255,0.92)"
      border="1px solid rgba(15,17,21,0.06)"
      p="18px"
    >
      <Text
        fontSize="11px"
        letterSpacing="0.16em"
        textTransform="uppercase"
        color="ink.500"
      >
        {eyebrow}
      </Text>
      <Heading mt="10px" size={title.length > 8 ? "md" : "lg"}>
        {title}
      </Heading>
      <Text mt="6px" color="ink.500">
        {description}
      </Text>
    </Box>
  );
}
