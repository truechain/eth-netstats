var geoip = require('geoip-lite');
var _ = require('lodash');
var trusted = require('./utils/config').trusted;

var MAX_HISTORY = 40;
var MAX_INACTIVE_TIME = 1000*60*60*4;

var Node = function(data)
{
	this.id = null;
	this.trusted = false;
	this.info = {};
	this.geo = {}
	this.stats = {
		active: false,
		mining: false,
		hashrate: 0,
		peers: 0,
		pending: 0,
		gasPrice: 0,
		fastBlock: {
			number: 0,
			hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
			gasLimit: 0,
			timestamp: 0,
			time: 0,
			arrival: 0,
			received: 0,
			propagation: 0,
			transactions: [],
		},
		snailBlock: {
			number: 0,
			hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
			difficulty: 0,
			totalDifficulty: 0,
			gasLimit: 0,
			timestamp: 0,
			time: 0,
			arrival: 0,
			received: 0,
			propagation: 0,
			uncles: [],
			fruits: 0
		},
		syncing: false,
		fastPropagationAvg: 0,
		snailPropagationAvg: 0,
		latency: 0,
		uptime: 100
	};

	this.fastHistory = new Array(MAX_HISTORY);
	this.snailHistory = new Array(MAX_HISTORY);

	this.uptime = {
		started: null,
		up: 0,
		down: 0,
		lastStatus: null,
		lastUpdate: null
	};

	this.init(data);

	return this;
}

Node.prototype.init = function(data)
{
	_.fill(this.fastHistory, -1);

	if( this.id === null && this.uptime.started === null )
		this.setState(true);

	this.id = _.result(data, 'id', this.id);

	if( !_.isUndefined(data.latency) )
		this.stats.latency = data.latency;

	this.setInfo(data, null);
}

Node.prototype.setInfo = function(data, callback)
{
	if( !_.isUndefined(data.info) )
	{
		this.info = data.info;

		if( !_.isUndefined(data.info.canUpdateHistory) )
		{
			this.info.canUpdateHistory = _.result(data, 'info.canUpdateHistory', false);
		}
	}

	if( !_.isUndefined(data.ip) )
	{
		if( trusted.indexOf(data.ip) >= 0 || process.env.LITE === 'true')
		{
			this.trusted = true;
		}

		this.setGeo(data.ip);
	}

	this.spark = _.result(data, 'spark', null);

	this.setState(true);

	if(callback !== null)
	{
		callback(null, this.getInfo());
	}
}

Node.prototype.setGeo = function(ip)
{
	this.info.ip = ip;
	this.geo = geoip.lookup(ip);
}

Node.prototype.getInfo = function(callback)
{
	return {
		id: this.id,
		info: this.info,
		stats: {
			active: this.stats.active,
			mining: this.stats.mining,
			syncing: this.stats.syncing,
			hashrate: this.stats.hashrate,
			peers: this.stats.peers,
			gasPrice: this.stats.gasPrice,
			block: this.stats.fastBlock,
			snailBlock: this.stats.snailBlock,
			fastPropagationAvg: this.stats.fastPropagationAvg,
			snailPropagationAvg: this.stats.snailPropagationAvg,
			uptime: this.stats.uptime,
			latency: this.stats.latency,
			pending: this.stats.pending,
		},
		fastHistory: this.fastHistory,
		snailHistory: this.snailHistory,
		geo: this.geo
	};
}

Node.prototype.setStats = function(stats, history, callback)
{
	if( !_.isUndefined(stats) )
	{
		this.setFastBlock( _.result(stats, 'fastBlock', this.stats.fastBlock), history, function (err, block) {} );

		this.setSnailBlock( _.result(stats, 'snailBlock', this.stats.snailBlock), history, function (err, block) {} );

		this.setBasicStats(stats, function (err, stats) {});

		this.setPending( _.result(stats, 'pending', this.stats.pending), function (err, stats) {} );

		callback(null, this.getStats());
	}

	callback('Stats undefined', null);
}

Node.prototype.setFastBlock = function(block, history, callback)
{
	if( !_.isUndefined(block) && !_.isUndefined(block.number) )
	{
		if ( !_.isEqual(history, this.fastHistory) || !_.isEqual(block, this.stats.fastBlock) )
		{
			if(block.number !== this.stats.fastBlock.number || block.hash !== this.stats.fastBlock.hash)
			{
				this.stats.fastBlock = block;
			}

			this.setFastHistory(history);

			callback(null, this.getFastBlockStats());
		}
		else
		{
			callback(null, null);
		}
	}
	else
	{
		callback('Block undefined', null);
	}
}

Node.prototype.setSnailBlock = function(block, history, callback)
{
	if( !_.isUndefined(block) && !_.isUndefined(block.number) )
	{
		if ( !_.isEqual(history, this.snailHistory) || !_.isEqual(block, this.stats.snailBlock) )
		{
			if(block.number !== this.stats.snailBlock.number || block.hash !== this.stats.snailBlock.hash)
			{
				this.stats.snailBlock = block;
			}

			this.setSnailHistory(history);

			callback(null, this.getSnailBlockStats());
		}
		else
		{
			callback(null, null);
		}
	}
	else
	{
		callback('Block undefined', null);
	}
}

Node.prototype.setFastHistory = function(history)
{
	if( _.isEqual(history, this.fastHistory) )
	{
		return false;
	}

	if( !_.isArray(history) )
	{
		this.fastHistory = _.fill( new Array(MAX_HISTORY), -1 );
		this.stats.fastPropagationAvg = 0;

		return true;
	}

	this.fastHistory = history;

	var positives = _.filter(history, function(p) {
		return p >= 0;
	});

	this.stats.fastPropagationAvg = ( positives.length > 0 ? Math.round( _.sum(positives) / positives.length ) : 0 );
	positives = null;

	return true;
}

Node.prototype.setSnailHistory = function(history)
{
	if( _.isEqual(history, this.snailHistory) )
	{
		return false;
	}

	if( !_.isArray(history) )
	{
		this.snailHistory = _.fill( new Array(MAX_HISTORY), -1 );
		this.stats.snailPropagationAvg = 0;

		return true;
	}

	this.snailHistory = history;

	var positives = _.filter(history, function(p) {
		return p >= 0;
	});

	this.stats.snailPropagationAvg = ( positives.length > 0 ? Math.round( _.sum(positives) / positives.length ) : 0 );
	positives = null;

	return true;
}

Node.prototype.setPending = function(stats, callback)
{
	if( !_.isUndefined(stats) && !_.isUndefined(stats.pending))
	{
		if(!_.isEqual(stats.pending, this.stats.pending))
		{
			this.stats.pending = stats.pending;

			callback(null, {
				id: this.id,
				pending: this.stats.pending
			});
		}
		else
		{
			callback(null, null);
		}
	}
	else
	{
		callback('Stats undefined', null);
	}
}

Node.prototype.setBasicStats = function(stats, callback)
{
	if( !_.isUndefined(stats) )
	{
		if( !_.isEqual(stats, {
			active: this.stats.active,
			mining: this.stats.mining,
			hashrate: this.stats.hashrate,
			peers: this.stats.peers,
			gasPrice: this.stats.gasPrice,
			uptime: this.stats.uptime
		}) )
		{
			this.stats.active = stats.active;
			this.stats.mining = stats.mining;
			this.stats.syncing = (!_.isUndefined(stats.syncing) ? stats.syncing : false);
			this.stats.hashrate = stats.hashrate;
			this.stats.peers = stats.peers;
			this.stats.gasPrice = stats.gasPrice;
			this.stats.uptime = stats.uptime;

			callback(null, this.getBasicStats());
		}
		else
		{
			callback(null, null);
		}
	}
	else
	{
		callback('Stats undefined', null);
	}
}

Node.prototype.setLatency = function(latency, callback)
{
	if( !_.isUndefined(latency) )
	{
		if( !_.isEqual(latency, this.stats.latency) )
		{
			this.stats.latency = latency;

			callback(null, {
				id: this.id,
				latency: latency
			});
		}
		else
		{
			callback(null, null);
		}
	}
	else
	{
		callback('Latency undefined', null);
	}
}

Node.prototype.getStats = function()
{
	return {
		id: this.id,
		stats: {
			active: this.stats.active,
			mining: this.stats.mining,
			syncing: this.stats.syncing,
			hashrate: this.stats.hashrate,
			peers: this.stats.peers,
			gasPrice: this.stats.gasPrice,
			fastBlock: this.stats.fastBlock,
			snailBlock: this.stats.snailBlock,
			fastPropagationAvg: this.stats.fastPropagationAvg,
			snailPropagationAvg: this.stats.snailPropagationAvg,
			uptime: this.stats.uptime,
			pending: this.stats.pending,
			latency: this.stats.latency
		},
		fastHistory: this.fastHistory,
		snailHistory: this.snailHistory
	};
}

Node.prototype.getFastBlockStats = function()
{
	return {
		id: this.id,
		block: this.stats.fastBlock,
		propagationAvg: this.stats.fastPropagationAvg,
		history: this.fastHistory
	};
}

Node.prototype.getSnailBlockStats = function()
{
	return {
		id: this.id,
		block: this.stats.snailBlock,
		propagationAvg: this.stats.snailPropagationAvg,
		history: this.snailHistory
	};
}

Node.prototype.getBasicStats = function()
{
	return {
		id: this.id,
		stats: {
			active: this.stats.active,
			mining: this.stats.mining,
			syncing: this.stats.syncing,
			hashrate: this.stats.hashrate,
			peers: this.stats.peers,
			gasPrice: this.stats.gasPrice,
			uptime: this.stats.uptime,
			latency: this.stats.latency
		}
	};
}

Node.prototype.setState = function(active)
{
	var now = _.now();

	if(this.uptime.started !== null)
	{
		if(this.uptime.lastStatus === active)
		{
			this.uptime[(active ? 'up' : 'down')] += now - this.uptime.lastUpdate;
		}
		else
		{
			this.uptime[(active ? 'down' : 'up')] += now - this.uptime.lastUpdate;
		}
	}
	else
	{
		this.uptime.started = now;
	}

	this.stats.active = active;
	this.uptime.lastStatus = active;
	this.uptime.lastUpdate = now;

	this.stats.uptime = this.calculateUptime();

	now = undefined;
}

Node.prototype.calculateUptime = function()
{
	if(this.uptime.lastUpdate === this.uptime.started)
	{
		return 100;
	}

	return Math.round( this.uptime.up / (this.uptime.lastUpdate - this.uptime.started) * 100);
}

Node.prototype.getFastBlockNumber = function()
{
	return this.stats.fastBlock.number;
}

Node.prototype.getSnailBlockNumber = function()
{
	return this.stats.snailBlock.number;
}

Node.prototype.canUpdate = function()
{
	if (this.trusted) {
		return true;
	}
	// return (this.info.canUpdateHistory && this.trusted) || false;
	return (this.info.canUpdateHistory || (this.stats.syncing === false && this.stats.peers > 0)) || false;
}

Node.prototype.isInactiveAndOld = function()
{
	if( this.uptime.lastStatus === false && this.uptime.lastUpdate !== null && (_.now() - this.uptime.lastUpdate) > MAX_INACTIVE_TIME )
	{
		return true;
	}

	return false;
}

module.exports = Node;
