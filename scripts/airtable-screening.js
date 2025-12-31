// Airtable Automation Script: OFAC Sanctions Screening
// Input: firstName, lastName
// Output: screening_result (human readable response)

const inputConfig = input.config();
const firstName = inputConfig.firstName || "";
const lastName = inputConfig.lastName || "";
const fullName = `${firstName} ${lastName}`.trim();

if (!fullName) {
  console.log("No name provided");
  output.set("screening_result", "Error: No name provided");
  throw new Error("No name provided");
}

console.log(`Screening name: ${fullName}`);

// Call the OFAC API
const apiUrl = `https://ofac-sl.a.selfhosted.hackclub.com/search/name?name=${encodeURIComponent(
  fullName
)}&limit=10`;

try {
  const response = await fetch(apiUrl);
  const data = await response.json();

  // Log full response
  console.log("Full API Response:");
  console.log(JSON.stringify(data, null, 2));

  // Output human readable result
  const humanReadable = data.human_readable || "No results";
  output.set("screening_result", humanReadable);

  console.log("\nHuman Readable Result:");
  console.log(humanReadable);
} catch (error) {
  console.log(`API Error: ${error.message}`);
  output.set("screening_result", `Error: ${error.message}`);
  throw error;
}
