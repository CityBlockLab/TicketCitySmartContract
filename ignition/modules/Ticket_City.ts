import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const Ticket_City_Module = buildModule("Ticket_City_Module", (m) => {
  const ticket_city = m.contract("Ticket_City");

  return { ticket_city };
});

export default Ticket_City_Module;
