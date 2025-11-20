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
  const confirmed = confirm(
    "This will initialize lookup tables with sample data, making\n" +
      "changes to the tables Category, Vehicle, UserInfo, Driver, and BankAccount.\n\n" +
      "10 users, 10 drivers, 10 categories, 10 vehicles, and bank accounts will be created.\n\n" +
      "Continue?"
  );
  if (!confirmed) {
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

  if (!confirmed) {
    await log("Simulation cancelled by user");
    return;
  }
  try {
    await log("Simulating 100 rides (with concurrent transactions)...");
    const out = await postJSON("/simulate", { n: 100 });

    await log(`Inserted ${out.inserted}, failed ${out.failed}`);

    if (out.totalTimeMs !== undefined) {
      await log(
        `Simulation batch completed in ${out.totalTimeMs.toFixed(
          2
        )} ms (avg ${out.avgTimeMs.toFixed(2)} ms per successful tx)`
      );
    }
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
    if (out.executionTime !== undefined) {
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

document.getElementById("recentRides").onclick = async () => {
  try {
    const out = await getJSON("/recent/rides?minutes=10");
    renderTable("report", out.rows);
    await log(
      `Viewed recent rides (last ${out.minutes || 10} minutes — ${
        out.rows.length
      } rows)`
    );
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("payDriver").onclick = async () => {
  const driverId = prompt("Enter driver_id to pay:");
  if (!driverId) {
    await log("Pay driver cancelled");
    return;
  }
  try {
    await log(`Paying driver ${driverId} (back office)...`);
    const out = await postJSON("/backend/pay-driver", {
      driver_id: Number(driverId),
    });

    if (out.paid > 0) {
      await log(
        `Paid driver ${out.driver_id} a total of $${out.paid.toFixed(2)}`
      );
    } else if (out.message) {
      await log(out.message);
    } else {
      await log(`No unpaid commission for driver ${driverId}`);
    }
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("browseDriverAccounts").onclick = async () => {
  try {
    const out = await getJSON(
      "/sql?q=" +
        encodeURIComponent(`
      SELECT * 
      FROM bank_account
      WHERE owner_type = 'DRIVER'
      ORDER BY acct_id;
    `)
    );
    renderTable("table", out.rows);
    await log(`Browsed DRIVER bank accounts (${out.rows.length} rows)`);
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("browseCompanyAccount").onclick = async () => {
  try {
    const out = await getJSON(
      "/sql?q=" +
        encodeURIComponent(`
      SELECT *
      FROM bank_account
      WHERE owner_type = 'COMPANY'
      ORDER BY acct_id;
    `)
    );
    renderTable("table", out.rows);
    await log(`Browsed COMPANY bank account`);
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};

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
document.getElementById("report4").onclick = async () => {
  try {
    const out = await getJSON("/report/4");
    renderTable("report", out.rows);
    await log("Ran report 4 (drivers by rating)");
  } catch (e) {
    await log("ERROR: " + e.message);
  }
};
document.getElementById("customRide").onclick = async () => {
  // Step 1: collect custom ride info
  const userId = prompt("Enter user_id for the ride:");
  if (!userId) {
    await log("Custom ride cancelled (no user_id)");
    return;
  }

  const driverId = prompt("Enter driver_id for the ride:");
  if (!driverId) {
    await log("Custom ride cancelled (no driver_id)");
    return;
  }

  const startZone = prompt("Enter start location (zone):");
  if (!startZone) {
    await log("Custom ride cancelled (no start location)");
    return;
  }

  const endZone = prompt("Enter end location (zone):");
  if (!endZone) {
    await log("Custom ride cancelled (no end location)");
    return;
  }

  try {
    // Step 2: call backend to book + pay
    await log(
      `Booking custom ride: user ${userId}, driver ${driverId}, ${startZone} → ${endZone}...`
    );
    const out = await postJSON("/frontdesk/custom-ride", {
      user_id: Number(userId),
      driver_id: Number(driverId),
      start_zone: startZone,
      end_zone: endZone,
    });

    const { result, executionTime } = out;
    await log(
      `Custom ride booked — ride_id=${result.ride_id}, total=$${result.total_amount} (tx ${executionTime}ms)`
    );

    // Step 3: ask for rating
    const ratingStr = prompt("Rate this ride from 1 to 5:");
    if (!ratingStr) {
      await log("Rating skipped");
      return;
    }

    const rating = Number(ratingStr);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      await log("Invalid rating. Must be a number between 1 and 5.");
      return;
    }

    // Step 4: send rating to backend
    const rateOut = await postJSON("/ride/rate", {
      ride_id: result.ride_id,
      rating,
    });

    await log(
      `Ride ${rateOut.ride_id} rated ${rateOut.rating}/5. ` +
        `Driver ${rateOut.driver_id} new average rating = ${rateOut.driver_rating}.`
    );
  } catch (e) {
    await log("ERROR (custom ride): " + e.message);
  }
};
