async function log(message) {
  const el = document.getElementById("log");
  el.value += `${new Date().toLocaleTimeString()} — ${message}\n`;
  el.scrollTop = el.scrollHeight;
}
function clearLog() {
  const el = document.getElementById("log");
  el.value = "";
}

function renderTable(divId, rows) {
  const div = document.getElementById(divId);
  if (!rows || !rows.length) {
    div.innerHTML = "<em>No rows</em>";
    return;
  }
  const cols = Object.keys(rows[0]);
  let html =
    '<div class="table-wrap-inner"><table><thead><tr>' +
    cols.map((c) => `<th>${c}</th>`).join("") +
    "</tr></thead><tbody>";
  for (const r of rows) {
    html +=
      "<tr>" + cols.map((c) => `<td>${r[c] ?? ""}</td>`).join("") + "</tr>";
  }
  html += "</tbody></table></div>";
  div.innerHTML = html;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok)
    throw new Error(`${url} failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`${url} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Button hooks
document.getElementById("createTables").onclick = async () => {
  try {
    await log("Creating tables...");
    const out = await postJSON("/create-tables");
    await log(out.message || "OK");
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("initLookups").onclick = async () => {
  const confirmed =  confirm(
    "This will initialize lookup tables with sample data, making\n" +
    "changes to the tables Category, Vehicle, UserInfo, Driver, and BankAccount.\n\n" + 
    "10 users, 10 drivers, 10 categories, 10 vehicles, and bank accounts will be created.\n\n" +
    "Continue?"
  );
  if(!confirmed){
    await log("Initialization cancelled by user");
    return;
  }
  try {
    await log("Initializing lookups/users/drivers/vehicles/accounts...");
    const out = await postJSON("/init-lookups");
    await log(out.message || "OK");
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("simulate").onclick = async () => {
  const confirmed = confirm(
    "This will simulate 100 ride bookings with payments.\n\n" +
    "This will add significant test data to the database.\n\n" +
    "Continue?"
  );

  if(!confirmed){
    await log("Simulation cancelled by user");
    return;
  }
  try {
    await log("Simulating 100 rides (with transactions)...");
    const out = await postJSON("/simulate", { n: 100 });
    await log(`Inserted ${out.inserted}, failed ${out.failed}`);
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("frontDesk").onclick = async () => {
  try {
    await log("Front desk booking (book + pay)...");
    const out = await postJSON("/frontdesk/book");
    await log(
      "Booked ride " +
        out.result.ride_id +
        ", total $" +
        out.result.total_amount
    );
    if(out.executionTime !== undefined){
      await log(`Transaction completed in ${out.executionTime}ms`);
    }

  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("clearLog").onclick = clearLog;

document.getElementById("deleteAllData").onclick = async () => {
  const confirmed = confirm(
    "WARNING: This will permanently delete ALL data from the database.\n\n" +
    "Tables will remain, but all rows will be deleted.\n\n" +
    "You'll need to click 'Init Lookups' to restore data.\n\n" +
    "Are you sure you want to continue?"
  );
  
  if (!confirmed) {
    await log("Delete cancelled by user");
    return;
  }
  try {
    await log("Deleting all data...");
    const out = await postJSON("/delete-all-data");
    await log(out.message);
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
// Browse buttons
const browse = async (t) => {
  try {
    const out = await getJSON("/browse/" + t + "?limit=10");
    renderTable("table", out.rows);
    await log("Browsed " + t);
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("browseUsers").onclick = () => browse("app_user");
document.getElementById("browseDrivers").onclick = () => browse("driver");
document.getElementById("browseVehicles").onclick = () => browse("vehicle");
document.getElementById("browseRides").onclick = () => browse("ride");
document.getElementById("browsePayments").onclick = () => browse("payment");
document.getElementById("browseAccounts").onclick = () =>
  browse("bank_account");
document.getElementById("browseCommission").onclick = () =>
  browse("company_commission");

// Reports
document.getElementById("report1").onclick = async () => {
  try {
    const out = await getJSON("/report/1");
    renderTable("report", out.rows);
    await log("Ran report 1");
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("report2").onclick = async () => {
  try {
    const out = await getJSON("/report/2");
    renderTable("report", out.rows);
    await log("Ran report 2");
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("report3").onclick = async () => {
  try {
    const out = await getJSON("/report/3");
    renderTable("report", out.rows);
    await log("Ran report 3");
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
