var _ = require('lodash');
var FastBlockchain = require('./fastHistory');
var SnailBlockchain = require('./snailHistory');
var Node = require('./node');

var Collection = function Collection(externalAPI)
{
	this._items = [];
	this._fastBlockchain = new FastBlockchain();
	this._snailBlockchain = new SnailBlockchain();
	this._askedForFastHistory = false;
	this._askedForFastHistoryTime = 0;
	this._askedForSnailHistory = false;
	this._askedForSnailHistoryTime = 0;
	this._debounced = null;
	this._externalAPI = externalAPI;
	this._highestFastBlock = 0;
	this._highestSnailBlock = 0;

	return this;
}

Collection.prototype.setupSockets = function()
{
	this._externalAPI.on('connection', function (spark)
	{
		this._externalAPI.on('latestBlock', function (data)
		{
			spark.emit('latestBlock', {
				number: this._highestBlock
			});
		});
	});
}

Collection.prototype.add = function(data, callback)
{
	var node = this.getNodeOrNew({ id : data.id }, data);
	node.setInfo(data, callback);
}

Collection.prototype.update = function(id, stats, callback)
{
	var node = this.getNode({ id: id });

	if (!node)
	{
		callback('Node not found', null);
	}
	else
	{
		// this._blockchain.clean(this.getBestBlockFromItems());

		var block = this._fastBlockchain.add(stats.block, id, node.trusted);

		if (!block)
		{
			callback('Block data wrong', null);
		}
		else
		{
			var propagationHistory = this._fastBlockchain.getNodePropagation(id);

			stats.block.arrived = block.block.arrived;
			stats.block.received = block.block.received;
			stats.block.propagation = block.block.propagation;

			node.setStats(stats, propagationHistory, callback);
		}
	}
}

Collection.prototype.addFastBlock = function(id, stats, callback)
{
	var node = this.getNode({ id: id });

	if (!node)
	{
		callback('Node not found', null);
	}
	else
	{
		// this._blockchain.clean(this.getBestBlockFromItems());

		var block = this._fastBlockchain.add(stats, id, node.trusted);

		if (!block)
		{
			callback('Block undefined', null);
		}
		else
		{
			var propagationHistory = this._fastBlockchain.getNodePropagation(id);

			stats.arrived = block.block.arrived;
			stats.received = block.block.received;
			stats.propagation = block.block.propagation;

			if(block.block.number > this._highestFastBlock)
			{
				this._highestFastBlock = block.block.number;
				this._externalAPI.write({
					action:"lastBlock",
					number: this._highestFastBlock
				});
			}

			node.setFastBlock(stats, propagationHistory, callback);
		}
	}
}

Collection.prototype.addSnailBlock = function(id, stats, callback)
{
	var node = this.getNode({ id: id });

	if (!node)
	{
		callback('Node not found', null);
	}
	else
	{
		// this._blockchain.clean(this.getBestBlockFromItems());

		var block = this._snailBlockchain.add(stats, id, node.trusted);

		if (!block)
		{
			callback('Block undefined', null);
		}
		else
		{
			var propagationHistory = this._snailBlockchain.getNodePropagation(id);

			stats.arrived = block.block.arrived;
			stats.received = block.block.received;
			stats.propagation = block.block.propagation;

			if(block.block.number > this._highestSnailBlock)
			{
				this._highestSnailBlock = block.block.number;
				this._externalAPI.write({
					action:"lastSnailBlock",
					number: this._highestSnailBlock
				});
			}

			node.setSnailBlock(stats, propagationHistory, callback);
		}
	}
}

Collection.prototype.updatePending = function(id, stats, callback)
{
	var node = this.getNode({ id: id });

	if (!node)
		return false;

	node.setPending(stats, callback);
}

Collection.prototype.updateBasicStats = function(id, stats, callback)
{
	var node = this.getNode({ id: id });

	if (!node)
	{
		callback('Node not found', null);
	}
	else
	{
		node.setBasicStats(stats, callback);
	}
}

// TODO: Async series
Collection.prototype.addFastHistory = function(id, blocks, callback)
{
	var node = this.getNode({ id: id });

	if (!node)
	{
		callback('Node not found', null)
	}
	else
	{
		blocks = blocks.reverse();

		// this._blockchain.clean(this.getBestBlockFromItems());

		for (var i = 0; i <= blocks.length - 1; i++)
		{
			this._fastBlockchain.add(blocks[i], id, node.trusted, true);
		};

		this.getCharts();
	}

	this.askedForFastHistory(false);
}

Collection.prototype.addSnailHistory = function(id, blocks, callback)
{
	var node = this.getNode({ id: id });

	if (!node)
	{
		callback('Node not found', null)
	}
	else
	{
		blocks = blocks.reverse();

		// this._blockchain.clean(this.getBestBlockFromItems());

		for (var i = 0; i <= blocks.length - 1; i++)
		{
			this._snailBlockchain.add(blocks[i], id, node.trusted, true);
		};

		this.getCharts();
	}

	this.askedForSnailHistory(false);
}

Collection.prototype.updateLatency = function(id, latency, callback)
{
	var node = this.getNode({ id: id });

	if (!node)
		return false;

	node.setLatency(latency, callback);
}

Collection.prototype.inactive = function(id, callback)
{
	var node = this.getNode({ spark: id });

	if (!node)
	{
		callback('Node not found', null);
	}
	else
	{
		node.setState(false);
		callback(null, node.getStats());
	}
}

Collection.prototype.getIndex = function(search)
{
	return _.findIndex(this._items, search);
}

Collection.prototype.getNode = function(search)
{
	var index = this.getIndex(search);

	if(index >= 0)
		return this._items[index];

	return false;
}

Collection.prototype.getNodeByIndex = function(index)
{
	if(this._items[index])
		return this._items[index];

	return false;
}

Collection.prototype.getIndexOrNew = function(search, data)
{
	var index = this.getIndex(search);

	return (index >= 0 ? index : this._items.push(new Node(data)) - 1);
}

Collection.prototype.getNodeOrNew = function(search, data)
{
	return this.getNodeByIndex(this.getIndexOrNew(search, data));
}

Collection.prototype.all = function()
{
	this.removeOldNodes();

	return this._items;
}

Collection.prototype.removeOldNodes = function()
{
	var deleteList = []

	for(var i = this._items.length - 1; i >= 0; i--)
	{
		if( this._items[i].isInactiveAndOld() )
		{
			deleteList.push(i);
		}
	}

	if(deleteList.length > 0)
	{
		for(var i = 0; i < deleteList.length; i++)
		{
			this._items.splice(deleteList[i], 1);
		}
	}
}

Collection.prototype.fastBlockPropagationChart = function()
{
	return this._fastBlockchain.getBlockPropagation();
}

Collection.prototype.snailBlockPropagationChart = function()
{
	return this._snailBlockchain.getBlockPropagation();
}

Collection.prototype.getUncleCount = function()
{
	return this._snailBlockchain.getUncleCount();
}

Collection.prototype.setFastChartsCallback = function(callback)
{
	this._fastBlockchain.setCallback(callback);
}

Collection.prototype.setSnailChartsCallback = function(callback)
{
	this._snailBlockchain.setCallback(callback);
}

Collection.prototype.getCharts = function()
{
	this.getChartsDebounced();
}

Collection.prototype.getChartsDebounced = function()
{
	var self = this;

	if( this._debounced === null) {
		this._debounced = _.debounce(function(){
			self._fastBlockchain.getCharts();
			self._snailBlockchain.getCharts();
		}, 1000, {
			leading: false,
			maxWait: 5000,
			trailing: true
		});
	}

	this._debounced();
}

Collection.prototype.getFastHistory = function()
{
	return this._fastBlockchain;
}

Collection.prototype.getSnailHistory = function()
{
	return this._snailBlockchain;
}

Collection.prototype.getBestFastBlockFromItems = function()
{
	return Math.max(this._fastBlockchain.bestBlockNumber(), _.result(_.max(this._items, function(item) {
		// return ( !item.trusted ? 0 : item.stats.block.number );
		return ( item.stats.block.number );
	}), 'stats.block.number', 0));
}

Collection.prototype.getBestSnailBlockFromItems = function()
{
	return Math.max(this._snailBlockchain.bestBlockNumber(), _.result(_.max(this._items, function(item) {
		// return ( !item.trusted ? 0 : item.stats.block.number );
		return ( item.stats.block.number );
	}), 'stats.block.number', 0));
}

Collection.prototype.canNodeUpdate = function(id)
{
	var node = this.getNode({id: id});

	if(!node)
		return false;

	if(node.canUpdate())
	{
		var fastDiff = node.getFastBlockNumber() - this._fastBlockchain.bestBlockNumber();
		var snailDiff = node.getSnailBlockNumber() - this._snailBlockchain.bestBlockNumber();

		return Boolean(fastDiff >= 0) || Boolean(snailDiff >= 0);
	}

	return false;
}

Collection.prototype.requiresUpdate = function(id)
{
	return this.requiresFastUpdate(id)
		|| this.requiresSnailUpdate(id);
}

Collection.prototype.requiresFastUpdate = function(id)
{
	return this.canNodeUpdate(id)
		&& this._fastBlockchain.requiresUpdate()
		&& (!this._askedForFastHistory || _.now() - this._askedForFastHistoryTime > 2 * 60 * 1000);
}

Collection.prototype.requiresSnailUpdate = function(id)
{
	return this.canNodeUpdate(id)
		&& this._snailBlockchain.requiresUpdate()
		&& (!this._askedForSnailHistory || _.now() - this._askedForSnailHistoryTime > 2 * 60 * 1000);
}

Collection.prototype.askedForFastHistory = function(set)
{
	if( !_.isUndefined(set) )
	{
		this._askedForFastHistory = set;

		if(set === true)
		{
			this._askedForFastHistoryTime = _.now();
		}
	}

	return (this._askedForFastHistory || _.now() - this._askedForFastHistoryTime < 2*60*1000);
}

Collection.prototype.askedForSnailHistory = function(set)
{
	if( !_.isUndefined(set) )
	{
		this._askedForSnailHistory = set;

		if(set === true)
		{
			this._askedForSnailHistoryTime = _.now();
		}
	}

	return (this._askedForSnailHistory || _.now() - this._askedForSnailHistoryTime < 2*60*1000);
}

module.exports = Collection;
