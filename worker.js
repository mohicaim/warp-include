export default {
  async fetch(request, env) {
    const OWNER = "Metamask-ctrl";
    const REPO = "warp-include";
    const PATH = "exclude.txt";
    const URL_PATH = "exclude_url.txt";
    const CF_ACCOUNT_ID = "9fbf4772e3a7bfe212fd0fabcb0b6ff5";
    
    if (!env.CF_API_TOKEN || !env.GITHUB_TOKEN) {
      return new Response(JSON.stringify({ error: "Cloudflare or GitHub Token missing" }), { status: 200 });
    }
*/

    try {
      // -----------------------------
      // 读取 exclude.txt
      // -----------------------------
      const githubApiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=main&t=${Date.now()}`;
      const githubRes = await fetch(githubApiUrl, {
        headers: {
          "Authorization": `token ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3.raw",
          "User-Agent": "Cloudflare-Worker-Updater"
        }
      });

      if (!githubRes.ok) throw new Error(`GitHub Error: ${githubRes.status}`);
      const text = await githubRes.text();

      const parsedLocalList = text.split('\n')
        .map(line => line.split('#')[0].trim())
        .filter(line => line !== "")
        .map(parseEntry)
        .filter(Boolean);

      // -----------------------------
      // 读取 exclude_url.txt
      // -----------------------------
      const urlListApi = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${URL_PATH}?ref=main&t=${Date.now()}`;
      const urlListRes = await fetch(urlListApi, {
        headers: {
          "Authorization": `token ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3.raw",
          "User-Agent": "Cloudflare-Worker-Updater"
        }
      });

      let parsedRemoteList = [];

      if (urlListRes.ok) {
        const urlText = await urlListRes.text();

        const urls = urlText.split("\n")
          .map(line => line.split("#")[0].trim())
          .filter(line => line !== "");

        // 逐个 URL 获取 IP 列表
        for (const url of urls) {
          try {
            const res = await fetch(url, { cf: { cacheTtl: 60 } });
            if (!res.ok) continue;

            const body = await res.text();
            const lines = body.split("\n");

            const parsed = lines
              .map(line => line.split("#")[0].trim())
              .filter(line => line !== "")
              .map(parseEntry)
              .filter(Boolean);

            parsedRemoteList.push(...parsed);

          } catch (e) {
            // 某个 URL 失败不影响整体
          }
        }
      }

      // -----------------------------
      // 合并 + 去重
      // -----------------------------
      const all = [...parsedLocalList, ...parsedRemoteList];

      const unique = [];
      const seen = new Set();

      for (const item of all) {
        const key = item.address || item.host;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(item);
        }
      }

      // -----------------------------
      // 提交到 Cloudflare
      // -----------------------------
      const cfApiUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/devices/policy/include`;
      const cfRes = await fetch(cfApiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(unique)
      });

      const cfData = await cfRes.json();

      return new Response(JSON.stringify({
        success: cfData.success,
        cloudflare_response: cfData,
        updated_count: unique.length,
        preview: unique.slice(-5)
      }));

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 200 });
    }
  }
};

// -----------------------------
// 工具函数：解析单行 entry
// -----------------------------
function parseEntry(line) {
  let entry = line;

  if (line.includes(']:')) {
    entry = line.split(']:')[0].replace('[', '');
  } else if (!line.includes(':') || (line.match(/:/g) || []).length === 1) {
    entry = line.split(':')[0];
  }

  const isIPv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}(\/[0-9]+)?$/.test(entry);
  const isIPv6 = /:/.test(entry);

  if (isIPv4 || isIPv6) {
    return {
      address: entry.includes('/') ? entry : `${entry}${isIPv4 ? "/32" : "/128"}`,
      description: "Auto-sync IP"
    };
  }

  return { host: entry, description: "Auto-sync Domain" };
}