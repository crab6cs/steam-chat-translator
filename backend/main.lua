local millennium = require("millennium")
local http = require("http")
local json = require("json")
local fs = require("fs")
local utils = require("utils")
local cache, order = {}, {}
local next_request_at = 0
local settings = {provider="google",api_key=""}
local rate_strikes = 0
local function reply(value) return json.encode(value) end
local function settings_path()
    local backend=utils.get_backend_path()
    if not backend then return nil end
    return fs.join(fs.parent_path(backend),"private-settings.json")
end
function GetSettings()
    return reply({provider=settings.provider,hasKey=settings.api_key~=""})
end
function SaveSettings(provider,api_key)
    if provider~="google" and provider~="deepl" then return reply({ok=false,error="Invalid provider."}) end
    if type(api_key)~="string" then return reply({ok=false,error="Invalid API key."}) end
    api_key=api_key:match("^%s*(.-)%s*$")
    if #api_key>256 or (api_key~="" and (#api_key<10 or api_key:find("[^%w%-%_:]"))) then
        return reply({ok=false,error="Invalid API key format."})
    end
    local key=api_key~="" and api_key or settings.api_key
    local path=settings_path()
    if not path then return reply({ok=false,error="Plugin settings path unavailable."}) end
    local ok=utils.write_file(path,json.encode({provider=provider,api_key=key}))
    if not ok then return reply({ok=false,error="Could not save local settings."}) end
    if settings.provider~=provider or settings.api_key~=key then cache,order={},{}; next_request_at=0;rate_strikes=0 end
    settings={provider=provider,api_key=key}
    return reply({ok=true,provider=provider,hasKey=key~=""})
end
local function escape(value)
    return (value:gsub("([^%w%-_%.~])", function(c) return string.format("%%%02X", string.byte(c)) end))
end

function TranslateBatch(texts_json)
    if type(texts_json) ~= "string" or #texts_json > 32000 then
        return reply({ok=false,error="Invalid translation batch."})
    end
    local valid, texts = pcall(json.decode, texts_json)
    if not valid or type(texts) ~= "table" or #texts < 1 or #texts > 8 then
        return reply({ok=false,error="A batch must contain 1 to 8 messages."})
    end
    local results, missing, bytes = {}, {}, 0
    for i, text in ipairs(texts) do
        if type(text) ~= "string" or #text == 0 or #text > 4000 then
            return reply({ok=false,error="Message is empty or too long (4000-byte limit)."})
        end
        bytes=bytes+#text
        if bytes>6000 then return reply({ok=false,error="Translation batch is too large."}) end
        if cache[text] then results[i]=cache[text] else missing[#missing+1]=i end
    end
    if #missing==0 then return reply({ok=true,results=results}) end
    if os.time()<next_request_at then
        return reply({ok=false,retryAfter=next_request_at-os.time(),error="Translation provider is cooling down. Try again shortly."})
    end
    -- Separate q parameters preserve per-message ordering, language detection,
    -- and multiline text. No Steam cookies, identities or metadata are sent.
    if settings.provider=="deepl" and settings.api_key=="" then return reply({ok=false,error="Add a DeepL API key in Settings."}) end
    local options={
        timeout=12,verify_ssl=true,follow_redirects=false,
        user_agent="Mozilla/5.0 (compatible; SteamChatTranslator/0.1)",
        headers={["Accept"]="application/json"}
    }
    local success,response
    if settings.provider=="deepl" then
        local payload={text={},target_lang="EN"}
        for _,i in ipairs(missing) do payload.text[#payload.text+1]=texts[i] end
        local host=settings.api_key:sub(-3)==":fx" and "https://api-free.deepl.com" or "https://api.deepl.com"
        options.headers["Authorization"]="DeepL-Auth-Key "..settings.api_key
        options.headers["Content-Type"]="application/json"
        success,response=pcall(http.post,host.."/v2/translate",json.encode(payload),options)
    else
        local url="https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=en"
        for _,i in ipairs(missing) do url=url.."&q="..escape(texts[i]) end
        success,response=pcall(http.get,url,options)
    end
    if not success or not response then
        return reply({ok=false,error="Translation service could not be reached. Original messages preserved."})
    end
    if response.status==429 or response.status==403 then
        if response.status==403 and settings.provider=="deepl" then return reply({ok=false,error="DeepL rejected the API key. Check it in Settings."}) end
        rate_strikes=math.min(rate_strikes+1,5)
        local backoff=math.min(600,60*2^(rate_strikes-1))
        next_request_at=os.time()+backoff
        return reply({ok=false,retryAfter=backoff,error="Translation provider rate limited requests. Waiting before retrying."})
    end
    if response.status~=200 then
        if response.status==456 then return reply({ok=false,error="DeepL character quota reached. Check your API plan."}) end
        return reply({ok=false,error="Translation service returned HTTP "..tostring(response.status)..". Try again later."})
    end
    local decoded_ok, data=pcall(json.decode,response.body)
    if decoded_ok and settings.provider=="deepl" and type(data)=="table" and type(data.translations)=="table" then
        local mapped={}
        for i,value in ipairs(data.translations) do
            if type(value)=="table" and type(value.text)=="string" and type(value.detected_source_language)=="string" then
                mapped[i]={value.text,value.detected_source_language:lower()}
            end
        end
        data=mapped
    end
    if not decoded_ok or type(data)~="table" or #data~=#missing then
        return reply({ok=false,error="Translation service returned an unexpected response."})
    end
    for _, value in ipairs(data) do
        if type(value)~="table" or type(value[1])~="string" or value[1]=="" or #value[1]>24000 or type(value[2])~="string" then
            return reply({ok=false,error="Translation service returned an invalid message."})
        end
    end
    for n,i in ipairs(missing) do
        local result={translated=data[n][1],source=data[n][2]}
        results[i]=result; cache[texts[i]]=result;order[#order+1]=texts[i]
        if #order>256 then cache[table.remove(order,1)]=nil end
    end
    rate_strikes=0; next_request_at=os.time()+5
    return reply({ok=true,results=results})
end

return {
    on_load=function()
        local path=settings_path()
        if path then
            local content=utils.read_file(path)
            if content then
                local ok,value=pcall(json.decode,content)
                if ok and type(value)=="table" and (value.provider=="google" or value.provider=="deepl") and type(value.api_key)=="string" then settings=value end
            end
        end
        millennium.ready()
    end,
    on_unload=function()cache,order={},{}end
}
