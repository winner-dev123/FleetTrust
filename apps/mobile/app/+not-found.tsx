import { copy } from "@fleettrust/copy";
import { useRouter } from "expo-router";

import { Body, Button, Heading, Screen } from "../src/components/ui";

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen>
      <Heading>{copy.notFound.title}</Heading>
      <Body>{copy.notFound.body}</Body>
      <Button
        label={copy.notFound.goToSearch}
        onPress={() => {
          router.replace("/");
        }}
      />
    </Screen>
  );
}
