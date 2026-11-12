local millennium = require("millennium")
local http = require("http")
local json = require("json")

-- No chat text is written to disk or logged. Cache lives only in this Lua VM.
local cache, order = {}, {}
local next_request_at = 0

local function reply(value)
    return json.encode(value)
end

local function escape(value)
    return (value:gsub("([^%w%-_%.~])", function(c)
        return string.format("%%%02X", string.byte(c))
    end))
end

function Translate(text)
    if type(text) ~= "string" or #text == 0 or #text > 4000 then
        return reply({ok = false, error = "Message is empty or too long (4000-byte limit)."})
    end
    if cache[text] then return reply(cache[text]) end
    if os.time() < next_request_at then
        return reply({ok = false, error = "Translation is temporarily paused by the provider. Try again shortly."})
    end

    -- Public, unofficial Google Translate endpoint. No Steam cookies, tokens,
    -- account IDs, names or conversation metadata are attached to this request.
    local url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" .. escape(text)
    local success, response = pcall(http.get, url, {
        timeout = 12,
        verify_ssl = true,
        follow_redirects = false,
        headers = { ["Accept"] = "application/json" }
    })
    if not success or not response then
        return reply({ok = false, error = "Translation service could not be reached. Original message preserved."})
    end
    if response.status == 429 or response.status == 403 then
        next_request_at = os.time() + 60
        return reply({ok = false, error = "Translation rate limit reached. Wait one minute, then retry."})
    end
    if response.status ~= 200 then
        return reply({ok = false, error = "Translation service returned an error. Try again later."})
    end
    local decoded_ok, data = pcall(json.decode, response.body)
    if not decoded_ok or type(data) ~= "table" or type(data[1]) ~= "table" or type(data[3]) ~= "string" then
        return reply({ok = false, error = "Translation service returned an unexpected response."})
    end
    local parts = {}
    for _, segment in ipairs(data[1]) do
        if type(segment) == "table" and type(segment[1]) == "string" then
            parts[#parts + 1] = segment[1]
        end
    end
    local translation = table.concat(parts)
    if translation == "" or #translation > 24000 then
        return reply({ok = false, error = "Translation was empty or too long."})
    end
    local result = {ok = true, translated = translation, source = data[3]}
    cache[text] = result
    order[#order + 1] = text
    if #order > 256 then cache[table.remove(order, 1)] = nil end
    return reply(result)
end

return {
    on_load = function() millennium.ready() end,
    on_unload = function() cache, order = {}, {} end
}
