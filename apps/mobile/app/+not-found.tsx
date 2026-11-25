import { useRouter } from "expo-router";

import { Body, Button, Heading, Screen } from "../src/components/ui";

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen>
      <Heading>Page not found</Heading>
      <Body>That link doesn&apos;t lead anywhere in the app.</Body>
      <Button
        label="Go to search"
        onPress={() => {
          router.replace("/");
        }}
      />
    </Screen>
  );
}
